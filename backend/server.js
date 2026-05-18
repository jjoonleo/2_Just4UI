const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_PORT = 8787;
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api/codex";
const DEFAULT_CODEX_AUTH_FILE = "~/.codex/auth.json";
const MAX_REQUEST_BYTES = 1024 * 1024;
const GUIDANCE_PLAN_MODES = {
  INITIAL: "initial",
  REFRESH: "refresh",
  CONTINUE_AFTER_WINDOW_ENDED: "continueAfterWindowEnded",
};
const SENSITIVE_VALUE_KEYS = new Set([
  "value",
  "currentValue",
  "typedValue",
  "inputValue",
  "selectedValue",
]);
const URL_KEYS = new Set(["url", "canonicalUrl", "href"]);

async function main() {
  const server = createBridgeBackendServer();
  const port = Number(process.env.BRIDGE_BACKEND_PORT || DEFAULT_PORT);
  server.listen(port, () => {
    logMetadata({
      event: "server_started",
      provider: process.env.BRIDGE_BACKEND_PROVIDER || "codex",
      port,
    });
  });
}

function createBridgeBackendServer({
  env = process.env,
  callProvider = callConfiguredProvider,
  maxRequestBytes = MAX_REQUEST_BYTES,
} = {}) {
  return http.createServer(async (req, res) => {
    const startedAt = Date.now();
    const requestId = crypto.randomUUID();

    try {
      if (req.method === "OPTIONS") {
        applyCors(req, res, env);
        res.writeHead(204);
        res.end();
        return;
      }

      applyCors(req, res, env);
      if (!isAllowedOrigin(req, env)) {
        writeJson(res, 403, { error: "Origin is not allowed." });
        return;
      }

      if (req.method === "GET" && req.url === "/health") {
        writeJson(res, 200, { ok: true });
        return;
      }

      if (req.method !== "POST" || req.url !== "/guidance-plan") {
        writeJson(res, 404, { error: "Not found." });
        return;
      }

      const rawBody = await readRequestBody(req, maxRequestBytes);
      const payloadBytes = Buffer.byteLength(rawBody);
      const payload = parseRequestJson(rawBody);
      const result = await handleGuidancePlanPayload(payload, {
        env,
        callProvider,
        requestId,
      });
      logMetadata({
        event: "guidance_plan_success",
        requestId,
        provider: providerFromEnv(env),
        model: modelFromEnv(env),
        mode: payload?.mode,
        payloadBytes,
        latencyMs: Date.now() - startedAt,
      });
      writeJson(res, 200, result);
    } catch (error) {
      const status = error.statusCode || 500;
      logMetadata({
        event: "guidance_plan_failure",
        requestId,
        provider: providerFromEnv(env),
        model: modelFromEnv(env),
        errorCategory: error.code || "server_error",
        status,
        latencyMs: Date.now() - startedAt,
      });
      writeJson(res, status, {
        error: error.exposeMessage || error.message || "Backend request failed.",
      });
    }
  });
}

async function handleGuidancePlanPayload(payload, { env, callProvider, requestId }) {
  validateGuidancePlanRequest(payload);
  const provider = providerFromEnv(env);
  if (provider !== "codex") {
    throw httpError(
      500,
      `Unsupported BRIDGE_BACKEND_PROVIDER: ${provider}. Only codex is supported.`,
      "unsupported_provider",
    );
  }
  if (!modelFromEnv(env)) {
    throw httpError(
      500,
      "BRIDGE_CODEX_MODEL is required for Codex backend provider.",
      "missing_codex_model",
    );
  }

  assertNoFormValues(payload.planningPayload);
  const safePlanningPayload = redactPlanningPayloadUrls(payload.planningPayload);
  const providerText = await callProvider(
    {
      contractVersion: payload.contractVersion,
      mode: normalizeGuidancePlanMode(payload.mode),
      taskRequest: payload.taskRequest,
      planningPayload: safePlanningPayload,
      previousSession: payload.previousSession || null,
      clarificationHistory: Array.isArray(payload.clarificationHistory)
        ? payload.clarificationHistory
        : [],
    },
    { env, requestId },
  );
  return parseProviderPlan(providerText);
}

async function callConfiguredProvider(payload, { env }) {
  return callCodexProvider(payload, { env });
}

async function callCodexProvider(payload, { env }) {
  const model = modelFromEnv(env);
  const credentials = readCodexCredentials(env);
  const baseUrl = (env.BRIDGE_CODEX_BASE_URL || DEFAULT_CODEX_BASE_URL).replace(
    /\/+$/,
    "",
  );
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credentials.accessToken}`,
      ...codexHeaders(credentials.accessToken),
    },
    body: JSON.stringify({
      model,
      instructions: guidancePlannerPromptLines(payload.mode).join(" "),
      input: JSON.stringify(guidancePlannerInput(payload)),
      text: {
        format: {
          type: "json_schema",
          name: "guidance_plan",
          strict: true,
          schema: openAiGuidancePlanSchema(payload.mode),
        },
      },
      store: false,
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw httpError(
      response.status >= 400 && response.status < 500 ? 502 : response.status,
      codexErrorMessage(data, response.status),
      "codex_request_failed",
    );
  }
  const text = extractOpenAiResponseText(data);
  if (!text) {
    throw httpError(502, "Codex returned no guidance plan text.", "empty_codex_response");
  }
  return text;
}

function validateGuidancePlanRequest(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw httpError(400, "Request body must be a JSON object.", "invalid_request");
  }
  if (payload.contractVersion !== 1) {
    throw httpError(400, "contractVersion must be 1.", "invalid_contract_version");
  }
  if (!Object.values(GUIDANCE_PLAN_MODES).includes(payload.mode)) {
    throw httpError(400, "mode is invalid.", "invalid_mode");
  }
  if (typeof payload.taskRequest !== "string" || !payload.taskRequest.trim()) {
    throw httpError(400, "taskRequest is required.", "missing_task_request");
  }
  if (
    !payload.planningPayload ||
    typeof payload.planningPayload !== "object" ||
    Array.isArray(payload.planningPayload)
  ) {
    throw httpError(400, "planningPayload must be an object.", "invalid_payload");
  }
  if (
    payload.clarificationHistory != null &&
    !Array.isArray(payload.clarificationHistory)
  ) {
    throw httpError(
      400,
      "clarificationHistory must be an array.",
      "invalid_clarification_history",
    );
  }
}

function parseRequestJson(rawBody) {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw httpError(400, "Request body must be valid JSON.", "invalid_json");
  }
}

function parseProviderPlan(rawText) {
  if (rawText && typeof rawText === "object" && !Array.isArray(rawText)) {
    return rawText;
  }
  const candidates = [
    String(rawText || ""),
    stripMarkdownJsonFence(String(rawText || "")),
    extractFirstJsonValue(String(rawText || "")),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next normalized provider output shape.
    }
  }
  throw httpError(502, "Codex returned invalid JSON.", "invalid_provider_json");
}

function assertNoFormValues(value, pathParts = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoFormValues(item, [...pathParts, index]));
    return;
  }
  if (!value || typeof value !== "object") return;

  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_VALUE_KEYS.has(key) && hasMeaningfulValue(child)) {
      throw httpError(
        400,
        "Planning Payload appears to contain user-entered form values.",
        "form_value_detected",
      );
    }
    assertNoFormValues(child, [...pathParts, key]);
  }
}

function hasMeaningfulValue(value) {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (value && typeof value === "object") {
    return Object.values(value).some(hasMeaningfulValue);
  }
  return false;
}

function redactPlanningPayloadUrls(value) {
  return redactUrlFields(structuredCloneCompatible(value));
}

function redactUrlFields(value) {
  if (Array.isArray(value)) return value.map(redactUrlFields);
  if (!value || typeof value !== "object") return value;
  const redacted = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] =
      URL_KEYS.has(key) && typeof child === "string"
        ? stripUrlQueryAndFragment(child)
        : redactUrlFields(child);
  }
  return redacted;
}

function stripUrlQueryAndFragment(rawUrl) {
  if (!rawUrl.trim()) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return rawUrl.split("#", 1)[0].split("?", 1)[0];
  }
}

function structuredCloneCompatible(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function readCodexCredentials(env) {
  const authFile = expandHome(env.BRIDGE_CODEX_AUTH_FILE || DEFAULT_CODEX_AUTH_FILE);
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(authFile, "utf8"));
  } catch {
    throw codexAuthError();
  }
  const tokens = payload?.tokens && typeof payload.tokens === "object"
    ? payload.tokens
    : payload;
  const accessToken = typeof tokens?.access_token === "string"
    ? tokens.access_token.trim()
    : "";
  if (!accessToken || isJwtExpired(accessToken)) {
    throw codexAuthError();
  }
  return { accessToken };
}

function codexAuthError() {
  return httpError(
    401,
    "Codex access token is missing or expired. Refresh Codex CLI auth, then restart the Bridge backend.",
    "codex_auth_missing_or_expired",
  );
}

function isJwtExpired(token, skewSeconds = 60) {
  const claims = decodeJwtPayload(token);
  if (!claims || typeof claims.exp !== "number") return false;
  const expiresAtMs = claims.exp * 1000;
  return expiresAtMs <= Date.now() + skewSeconds * 1000;
}

function decodeJwtPayload(token) {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(Buffer.from(padded, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function codexHeaders(accessToken) {
  const headers = {
    "User-Agent": "codex_cli_rs/0.0.0 (Bridge Guided Task Mode)",
    originator: "codex_cli_rs",
  };
  const accountId = decodeJwtPayload(accessToken)?.["https://api.openai.com/auth"]
    ?.chatgpt_account_id;
  if (typeof accountId === "string" && accountId) {
    headers["ChatGPT-Account-ID"] = accountId;
  }
  return headers;
}

function codexErrorMessage(data, status) {
  const message =
    data?.error?.message ||
    data?.error_description ||
    data?.message ||
    `Codex request failed with HTTP ${status}.`;
  return `Codex plan creation failed. ${message}`;
}

function extractOpenAiResponseText(response) {
  if (typeof response?.output_text === "string") return response.output_text;
  const chunks = [];
  for (const item of response?.output || []) {
    for (const content of item.content || []) {
      if (typeof content.text === "string") chunks.push(content.text);
    }
  }
  return chunks.join("").trim();
}

function guidancePlannerPromptLines(mode) {
  return [
    ...guidancePlannerBasePromptLines(),
    ...guidancePlannerModePromptLines(mode),
  ];
}

function guidancePlannerBasePromptLines() {
  return [
    "Create a guide-only browser assistance plan.",
    "Return only JSON that follows the provided schema.",
    "Return status=ready with a progressive plan window when the next useful target/action is clear.",
    "Return status=needsClarification, one direct question, and no steps only when ambiguity changes which page target or action should be guided next.",
    "Do not ask clarification for missing values that the user can type into an identifiable input field; highlight the field instead.",
    "Do not ask clarification for equivalent duplicate targets; choose the visible primary target.",
    "Return only the active generated window from the current point, not the whole plan or completed history.",
    "Use the planner mode to decide how many not-yet-completed steps belong in the active generated window.",
    "Do not generate the full workflow upfront.",
    "Do not rewrite completed steps from previousSession. Only add or revise not-yet-reached guidance.",
    "Completed steps are immutable locked history: do not modify, rename, reorder, reinterpret, remove, downgrade, or return them as current or not-completed.",
    "Use previousSession.planSoFar, previousSession.completedStepHistory, previousSession.currentStep, and previousSession.aheadSteps to understand what has already been guided.",
    "Do not duplicate any completed step, current step, or ahead step unless the current page evidence proves the user must repeat it.",
    "Keep the plan compact: one short summary and at most 3 assumptions.",
    "Never ask the extension to click, type, submit, purchase, delete, or confirm for the user.",
    "Each step must point to one primary target from the current planning payload.",
    "For clickable targets such as buttons and links, use completion.type=click so a user click can mark the step completed before navigation.",
    "Use completion.type=manual only when no reliable page event can indicate that the user completed the step.",
    "Do not add fields or instructions that mark the user's task as complete. The user decides whether to ask for another step or end the guide.",
    "Use risk=high for checkout, payment, personal information submission, account deletion, or destructive actions.",
    "Treat clarificationHistory answers as authoritative.",
    "Use empty strings for unknown optional target or completion fields.",
  ];
}

function guidancePlannerModePromptLines(mode) {
  if (mode === GUIDANCE_PLAN_MODES.INITIAL) {
    return [
      "Planner mode: initial.",
      "Create the first current step for this task from the current page evidence.",
      "Optionally include one future preview step only if it is clearly useful from the current page evidence.",
      "Return at most 2 steps: the current actionable step plus one optional preview step.",
      "There is no completed history for this first guide unless clarificationHistory says otherwise.",
    ];
  }
  if (mode === GUIDANCE_PLAN_MODES.CONTINUE_AFTER_WINDOW_ENDED) {
    return [
      "Planner mode: continueAfterWindowEnded.",
      "The visible generated window is exhausted because the user requested another step.",
      "Return only additions after completed history.",
      "Do not reinterpret, reorder, rewrite, or repeat completed steps.",
      "Completed steps are locked and non-editable in this mode; any returned step matching completed history is invalid.",
      "Do not return any completed, current, or already-previewed step from previousSession.",
      "When adding a next step, choose the first useful step after the completed history and the existing plan window.",
      "Return at most 2 steps: the next actionable addition plus one optional preview addition.",
      "If no new useful step can be identified, ask one clarification question instead of repeating prior steps.",
    ];
  }
  return [
    "Planner mode: refresh.",
    "Use current page evidence to repair stale future/current guidance.",
    "Do not treat refresh as a request to restart the guide.",
    "Strictly preserve completed steps from previousSession exactly; never modify or return them.",
    "Preserve session progress and continue from the active tab's current page evidence.",
    "Return all task-relevant not-yet-completed steps possible on the current page, up to 8 steps.",
    "Only include steps relevant to taskRequest and current page evidence; ignore unrelated visible controls.",
    "Only the first returned step is the current actionable step; later returned steps are future not-completed steps.",
    "Revise only stale not-yet-completed guidance for the current page.",
  ];
}

function guidancePlannerInput({
  mode,
  taskRequest,
  previousSession,
  clarificationHistory,
  planningPayload,
}) {
  return {
    mode,
    taskRequest,
    previousSession,
    clarificationHistory: compactClarificationHistory(clarificationHistory),
    planningPayload,
  };
}

function compactClarificationHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-6).map((item) =>
    compactObject({
      question: stringOrNull(item?.question),
      answer: stringOrNull(item?.answer),
    }),
  );
}

function openAiGuidancePlanSchema(mode = GUIDANCE_PLAN_MODES.INITIAL) {
  const maxSteps = maxStepsForGuidancePlanMode(normalizeGuidancePlanMode(mode));
  const stringField = { type: "string" };
  const targetSchema = {
    type: "object",
    additionalProperties: false,
    required: [
      "snapshotId",
      "kind",
      "role",
      "label",
      "text",
      "selector",
      "href",
      "name",
      "type",
      "placeholder",
    ],
    properties: {
      snapshotId: stringField,
      kind: stringField,
      role: stringField,
      label: stringField,
      text: stringField,
      selector: stringField,
      href: stringField,
      name: stringField,
      type: stringField,
      placeholder: stringField,
    },
  };
  return {
    type: "object",
    additionalProperties: false,
    required: [
      "status",
      "question",
      "clarifiedTaskRequest",
      "summary",
      "assumptions",
      "steps",
    ],
    properties: {
      status: { type: "string", enum: ["needsClarification", "ready"] },
      question: stringField,
      clarifiedTaskRequest: stringField,
      summary: stringField,
      assumptions: { type: "array", maxItems: 3, items: stringField },
      steps: {
        type: "array",
        minItems: 0,
        maxItems: maxSteps,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "id",
            "title",
            "instruction",
            "target",
            "completion",
            "risk",
          ],
          properties: {
            id: stringField,
            title: stringField,
            instruction: stringField,
            risk: { type: "string", enum: ["low", "medium", "high"] },
            target: targetSchema,
            completion: {
              type: "object",
              additionalProperties: false,
              required: ["type", "value"],
              properties: {
                type: {
                  type: "string",
                  enum: [
                    "manual",
                    "click",
                    "inputChanged",
                    "inputValueEquals",
                    "checked",
                    "urlChanged",
                    "dialogAppears",
                  ],
                },
                value: stringField,
              },
            },
          },
        },
      },
    },
  };
}

function normalizeGuidancePlanMode(mode) {
  return Object.values(GUIDANCE_PLAN_MODES).includes(mode)
    ? mode
    : GUIDANCE_PLAN_MODES.REFRESH;
}

function maxStepsForGuidancePlanMode(mode) {
  return mode === GUIDANCE_PLAN_MODES.REFRESH ? 8 : 2;
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

function stripMarkdownJsonFence(rawText) {
  const trimmed = rawText.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() || null;
}

function extractFirstJsonValue(rawText) {
  const startIndex = rawText.search(/[\[{]/);
  if (startIndex < 0) return null;

  const stack = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < rawText.length; index += 1) {
    const character = rawText[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }

    if (character === '"') inString = true;
    else if (character === "{" || character === "[")
      stack.push(character === "{" ? "}" : "]");
    else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) return rawText.slice(startIndex, index + 1).trim();
    }
  }
  return null;
}

function readRequestBody(req, maxRequestBytes) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(req.headers["content-length"] || 0);
    if (contentLength > maxRequestBytes) {
      reject(httpError(413, "Request body is too large.", "request_too_large"));
      return;
    }

    let size = 0;
    const chunks = [];
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxRequestBytes) {
        reject(httpError(413, "Request body is too large.", "request_too_large"));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function applyCors(req, res, env) {
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(req, env)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS, GET");
  }
}

function isAllowedOrigin(req, env) {
  const origin = req.headers.origin;
  if (!origin) return true;
  return Boolean(env.BRIDGE_EXTENSION_ORIGIN && origin === env.BRIDGE_EXTENSION_ORIGIN);
}

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  error.exposeMessage = message;
  return error;
}

function providerFromEnv(env) {
  return (env.BRIDGE_BACKEND_PROVIDER || "codex").trim().toLowerCase();
}

function modelFromEnv(env) {
  return (env.BRIDGE_CODEX_MODEL || "").trim();
}

function expandHome(filePath) {
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function logMetadata(metadata) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), ...metadata }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message || error);
    process.exit(1);
  });
}

module.exports = {
  MAX_REQUEST_BYTES,
  assertNoFormValues,
  createBridgeBackendServer,
  handleGuidancePlanPayload,
  isJwtExpired,
  parseProviderPlan,
  redactPlanningPayloadUrls,
  stripUrlQueryAndFragment,
  validateGuidancePlanRequest,
};

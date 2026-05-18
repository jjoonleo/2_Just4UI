export const GUIDANCE_PLAN_MODES = {
  INITIAL: "initial",
  REFRESH: "refresh",
  CONTINUE_AFTER_WINDOW_ENDED: "continueAfterWindowEnded"
} as const;

export type GuidancePlanMode =
  (typeof GUIDANCE_PLAN_MODES)[keyof typeof GUIDANCE_PLAN_MODES];

export type GuidanceRisk = "low" | "medium" | "high";

export type GuidanceCompletionType =
  | "manual"
  | "click"
  | "inputChanged"
  | "inputValueEquals"
  | "checked"
  | "urlChanged"
  | "dialogAppears";

export interface GuidanceTarget {
  snapshotId: string | null;
  kind: string | null;
  role: string | null;
  label: string | null;
  text: string | null;
  selector: string | null;
  href: string | null;
  name: string | null;
  type: string | null;
  placeholder: string | null;
  bounds: Record<string, unknown> | null;
}

export interface GuidanceCompletion {
  type: GuidanceCompletionType | string;
  value: string | null;
}

export interface GuidanceStep {
  id: string;
  title: string;
  instruction: string;
  target: GuidanceTarget;
  completion: GuidanceCompletion;
  risk: GuidanceRisk;
}

export interface GuidancePlan {
  status: "ready";
  question: "";
  clarifiedTaskRequest: string;
  summary: string;
  assumptions: string[];
  steps: GuidanceStep[];
}

export interface TaskClarificationDecision {
  status: "needsClarification";
  question: string;
  clarifiedTaskRequest: string;
  assumptions: string[];
  steps: [];
}

export type GuidancePlanDecision = GuidancePlan | TaskClarificationDecision;

const SENSITIVE_VALUE_KEYS = new Set([
  "value",
  "currentValue",
  "typedValue",
  "inputValue",
  "selectedValue"
]);

const URL_KEYS = new Set(["url", "canonicalUrl", "href"]);
const EXTENSION_ACTOR_PATTERN =
  /\b(?:bridge|extension|assistant|agent|model|ai|system|we|i)\b[\s\S]{0,48}\b(?:click|type|enter|submit|purchase|buy|delete|remove|confirm|press|choose|select|fill|send)\b/i;
const HIGH_RISK_ACTION_PATTERN =
  /\b(?:checkout|payment|pay|purchase|buy|order|confirm purchase|credit card|card number|cvv|ssn|social security|personal information|personal info|password|home address|address|phone number|date of birth|birth date|delete account|remove account|delete|destructive|irreversible)\b/i;

export function normalizeGuidancePlanMode(mode: unknown): GuidancePlanMode {
  return isGuidancePlanMode(mode) ? mode : GUIDANCE_PLAN_MODES.REFRESH;
}

export function maxStepsForGuidancePlanMode(mode: unknown): number {
  return normalizeGuidancePlanMode(mode) === GUIDANCE_PLAN_MODES.REFRESH ? 8 : 2;
}

export function parseProviderPlan(rawText: unknown): unknown {
  if (isRecord(rawText)) return rawText;
  const text = String(rawText || "");
  const candidates = [
    text,
    stripMarkdownJsonFence(text),
    extractFirstJsonValue(text)
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next normalized provider output shape.
    }
  }

  throw new Error("Provider returned invalid JSON.");
}

export function assertNoFormValues(value: unknown): void {
  rejectFormValues(value);
}

export function redactPlanningPayloadUrls<T>(value: T): T {
  return redactUrlFields(structuredCloneCompatible(value)) as T;
}

export function validateGuidancePlan(
  plan: unknown,
  fallbackTaskRequest = "",
  mode: unknown = GUIDANCE_PLAN_MODES.INITIAL
): GuidancePlanDecision {
  if (!isRecord(plan)) throw new Error("Guidance plan must be an object.");

  const normalizedMode = normalizeGuidancePlanMode(mode);
  const maxSteps = maxStepsForGuidancePlanMode(normalizedMode);
  const status =
    plan.status === "needsClarification" ? "needsClarification" : "ready";
  const question = stringOrNull(plan.question) || "";
  const clarifiedTaskRequest =
    stringOrNull(plan.clarifiedTaskRequest) || fallbackTaskRequest;
  const assumptions = Array.isArray(plan.assumptions)
    ? plan.assumptions
        .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
        .slice(0, 3)
    : [];

  if (!clarifiedTaskRequest) {
    throw new Error("Clarified task request is missing.");
  }

  if (status === "needsClarification") {
    if (!question) throw new Error("Task clarification question is missing.");
    if (Array.isArray(plan.steps) && plan.steps.length) {
      throw new Error("Task clarification response must not include guidance steps.");
    }
    return {
      status,
      question,
      clarifiedTaskRequest,
      assumptions,
      steps: []
    };
  }

  if (typeof plan.summary !== "string" || !plan.summary.trim()) {
    throw new Error("Guidance plan summary is missing.");
  }
  if (!Array.isArray(plan.steps) || !plan.steps.length) {
    throw new Error("Guidance plan must include at least one step.");
  }
  if (plan.steps.length > maxSteps) {
    throw new Error(
      `Guidance plan for ${normalizedMode} must include at most ${maxSteps} steps.`
    );
  }

  return {
    status,
    question: "",
    clarifiedTaskRequest,
    summary: plan.summary.trim(),
    assumptions,
    steps: plan.steps.map((step, index) => normalizeGuidanceStep(step, index))
  };
}

export function validateGuideOnlyPolicy(
  plan: GuidancePlanDecision
): GuidancePlanDecision {
  if (plan.status === "needsClarification") return plan;

  return {
    ...plan,
    steps: plan.steps.map((step, index) => validateGuideOnlyStep(step, index))
  };
}

function validateGuideOnlyStep(step: GuidanceStep, index: number): GuidanceStep {
  const policyText = [
    step.title,
    step.instruction,
    step.target?.label,
    step.target?.text,
    step.target?.placeholder
  ].join(" ");

  if (EXTENSION_ACTOR_PATTERN.test(policyText)) {
    throw new Error(
      `Guide-Only policy violation in step ${index + 1}: the extension must not perform page actions for the user.`
    );
  }

  if (step.risk !== "high" && HIGH_RISK_ACTION_PATTERN.test(policyText)) {
    return { ...step, risk: "high" };
  }

  return step;
}

function normalizeGuidanceStep(step: unknown, index: number): GuidanceStep {
  if (!isRecord(step)) throw new Error(`Step ${index + 1} is invalid.`);
  if (typeof step.title !== "string" || !step.title.trim()) {
    throw new Error(`Step ${index + 1} is missing a title.`);
  }
  if (typeof step.instruction !== "string" || !step.instruction.trim()) {
    throw new Error(`Step ${index + 1} is missing an instruction.`);
  }
  if (!isRecord(step.target)) throw new Error(`Step ${index + 1} is missing a target.`);

  return {
    id: stringOrNull(step.id) || `step-${index + 1}`,
    title: step.title.trim(),
    instruction: step.instruction.trim(),
    target: normalizeTarget(step.target),
    completion: normalizeCompletion(step.completion, step.target),
    risk: isGuidanceRisk(step.risk) ? step.risk : "low"
  };
}

function normalizeTarget(target: Record<string, unknown>): GuidanceTarget {
  return {
    snapshotId: stringOrNull(target.snapshotId),
    kind: stringOrNull(target.kind),
    role: stringOrNull(target.role),
    label: stringOrNull(target.label),
    text: stringOrNull(target.text),
    selector: stringOrNull(target.selector),
    href: stringOrNull(target.href),
    name: stringOrNull(target.name),
    type: stringOrNull(target.type),
    placeholder: stringOrNull(target.placeholder),
    bounds: isRecord(target.bounds) ? target.bounds : null
  };
}

function normalizeCompletion(
  completion: unknown,
  target: Record<string, unknown>
): GuidanceCompletion {
  if (!isRecord(completion)) {
    return {
      type: isClickableTarget(target) ? "click" : "manual",
      value: null
    };
  }

  const type =
    typeof completion.type === "string" && completion.type.trim()
      ? completion.type.trim()
      : "manual";
  return {
    type: type === "manual" && isClickableTarget(target) ? "click" : type,
    value: completion.value == null ? null : String(completion.value)
  };
}

function isClickableTarget(target: Record<string, unknown>): boolean {
  const role = String(target.role || "").toLowerCase();
  const kind = String(target.kind || "").toLowerCase();
  return (
    role === "button" ||
    role === "link" ||
    kind === "button" ||
    kind === "link" ||
    Boolean(target.href)
  );
}

function rejectFormValues(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach((item) => rejectFormValues(item));
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_VALUE_KEYS.has(key) && hasMeaningfulValue(child)) {
      throw new Error("Planning Payload appears to contain user-entered form values.");
    }
    rejectFormValues(child);
  }
}

function hasMeaningfulValue(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (typeof value === "number" || typeof value === "boolean") return true;
  if (Array.isArray(value)) return value.some(hasMeaningfulValue);
  if (isRecord(value)) return Object.values(value).some(hasMeaningfulValue);
  return false;
}

function redactUrlFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactUrlFields);
  if (!isRecord(value)) return value;

  const redacted: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    redacted[key] =
      URL_KEYS.has(key) && typeof child === "string"
        ? stripUrlQueryAndFragment(child)
        : redactUrlFields(child);
  }
  return redacted;
}

function stripUrlQueryAndFragment(rawUrl: string): string {
  if (!rawUrl.trim()) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    const withoutFragment = rawUrl.split("#", 1)[0] ?? "";
    return withoutFragment.split("?", 1)[0] ?? "";
  }
}

function stripMarkdownJsonFence(rawText: string): string | null {
  const trimmed = rawText.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() || null;
}

function extractFirstJsonValue(rawText: string): string | null {
  const startIndex = rawText.search(/[\[{]/);
  if (startIndex < 0) return null;

  const stack: string[] = [];
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < rawText.length; index += 1) {
    const character = rawText[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      stack.push(character === "{" ? "}" : "]");
    } else if (character === "}" || character === "]") {
      if (stack.pop() !== character) return null;
      if (stack.length === 0) return rawText.slice(startIndex, index + 1).trim();
    }
  }

  return null;
}

function structuredCloneCompatible(value: unknown): unknown {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isGuidancePlanMode(mode: unknown): mode is GuidancePlanMode {
  return (
    mode === GUIDANCE_PLAN_MODES.INITIAL ||
    mode === GUIDANCE_PLAN_MODES.REFRESH ||
    mode === GUIDANCE_PLAN_MODES.CONTINUE_AFTER_WINDOW_ENDED
  );
}

function isGuidanceRisk(value: unknown): value is GuidanceRisk {
  return value === "low" || value === "medium" || value === "high";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

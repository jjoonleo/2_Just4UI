const SESSION_STORAGE_KEY = "bridgeGuidanceSessions";
const PROVIDER_CONFIG = {
  gemini: {
    apiKeyStorageKey: "bridgeGeminiApiKey",
    defaultModel: "gemini-2.5-flash",
    label: "Gemini"
  },
  openai: {
    apiKeyStorageKey: "bridgeOpenAiApiKey",
    defaultModel: "gpt-4.1-mini",
    label: "OpenAI"
  }
};
const SESSION_TTL_MS = 30 * 60 * 1000;

chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);

chrome.action.onClicked.addListener(async (tab) => {
  if (tab.windowId == null) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

async function configureSidePanel() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "BRIDGE_START_GUIDE") {
    startGuide(message).then(sendResponse).catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_GUIDE_PROGRESS" && sender.tab?.id) {
    updateProgress(sender.tab.id, message).catch(() => {});
  }

  if (message?.type === "BRIDGE_END_GUIDE" && sender.tab?.id) {
    expireSession(sender.tab.id).catch(() => {});
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  refreshAfterNavigation(tabId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId) => {
  expireSession(tabId).catch(() => {});
});

async function startGuide({ tabId, provider = "gemini", taskRequest, model }) {
  const modelProvider = normalizeProvider(provider);
  const providerConfig = PROVIDER_CONFIG[modelProvider];
  const stored = await chrome.storage.local.get(providerConfig.apiKeyStorageKey);
  const apiKey = stored[providerConfig.apiKeyStorageKey];
  if (!apiKey) throw new Error(`${providerConfig.label} API key is missing.`);

  const snapshot = await extractSnapshotFromTab(tabId);
  const planningPayload = createPlanningPayload(snapshot);
  const plan = await createGuidancePlan({
    provider: modelProvider,
    apiKey,
    model: model || providerConfig.defaultModel,
    taskRequest,
    planningPayload,
    previousSession: null
  });

  const now = Date.now();
  const session = {
    tabId,
    provider: modelProvider,
    taskRequest,
    model: model || providerConfig.defaultModel,
    plan,
    currentStepIndex: 0,
    completedStepSummaries: [],
    status: "active",
    consecutiveRefreshFailures: 0,
    createdAt: now,
    updatedAt: now
  };

  await saveSession(tabId, session);
  await renderOverlay(tabId, session);
  return { ok: true };
}

async function refreshAfterNavigation(tabId) {
  const session = await getSession(tabId);
  if (!session) return;
  if (isExpired(session)) {
    await expireSession(tabId);
    return;
  }

  try {
    const modelProvider = normalizeProvider(session.provider);
    const providerConfig = PROVIDER_CONFIG[modelProvider];
    const stored = await chrome.storage.local.get(providerConfig.apiKeyStorageKey);
    const apiKey = stored[providerConfig.apiKeyStorageKey];
    if (!apiKey) throw new Error(`${providerConfig.label} API key is missing.`);

    const snapshot = await extractSnapshotFromTab(tabId);
    const planningPayload = createPlanningPayload(snapshot);
    const refreshedPlan = await createGuidancePlan({
      provider: modelProvider,
      apiKey,
      model: session.model || providerConfig.defaultModel,
      taskRequest: session.taskRequest,
      planningPayload,
      previousSession: summarizeSession(session)
    });

    const refreshed = {
      ...session,
      plan: refreshedPlan,
      currentStepIndex: 0,
      status: "active",
      consecutiveRefreshFailures: 0,
      updatedAt: Date.now()
    };
    await saveSession(tabId, refreshed);
    await renderOverlay(tabId, refreshed, "Guide refreshed for this page.");
  } catch (error) {
    if (session.status === "paused" || session.consecutiveRefreshFailures >= 1) {
      await expireSession(tabId);
      return;
    }

    await saveSession(tabId, {
      ...session,
      status: "paused",
      consecutiveRefreshFailures: session.consecutiveRefreshFailures + 1,
      lastError: error.message,
      updatedAt: Date.now()
    });
  }
}

async function updateProgress(tabId, message) {
  const session = await getSession(tabId);
  if (!session) return;

  const nextIndex = Number.isInteger(message.currentStepIndex) ? message.currentStepIndex : session.currentStepIndex;
  const completedStep = message.completedStep;
  const completedStepSummaries = [...(session.completedStepSummaries || [])];
  if (completedStep && !completedStepSummaries.includes(completedStep)) {
    completedStepSummaries.push(completedStep);
  }

  await saveSession(tabId, {
    ...session,
    currentStepIndex: nextIndex,
    completedStepSummaries: completedStepSummaries.slice(-12),
    updatedAt: Date.now()
  });
}

async function extractSnapshotFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPageSnapshotForGuide
  });
  if (!result) throw new Error("Page snapshot could not be extracted.");
  return result;
}

async function renderOverlay(tabId, session, message = "") {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: installGuidedTaskOverlay,
    args: [session.plan, { currentStepIndex: session.currentStepIndex || 0, message }]
  });
}

async function getSessions() {
  const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  return stored[SESSION_STORAGE_KEY] || {};
}

async function getSession(tabId) {
  const sessions = await getSessions();
  return sessions[String(tabId)] || null;
}

async function saveSession(tabId, session) {
  const sessions = await getSessions();
  sessions[String(tabId)] = session;
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sessions });
}

async function expireSession(tabId) {
  const sessions = await getSessions();
  delete sessions[String(tabId)];
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: sessions });
}

function isExpired(session) {
  return Date.now() - Number(session.createdAt || 0) > SESSION_TTL_MS;
}

function summarizeSession(session) {
  return {
    taskRequest: session.taskRequest,
    currentStepIndex: session.currentStepIndex || 0,
    completedStepSummaries: session.completedStepSummaries || [],
    previousSummary: session.plan?.summary || "",
    previousCurrentStep: session.plan?.steps?.[session.currentStepIndex || 0] || null
  };
}

function normalizeProvider(provider) {
  return provider === "openai" ? "openai" : "gemini";
}

function createPlanningPayload(snapshot) {
  const content = snapshot.content || {};
  const textBlocks = (content.textBlocks || []).filter((item) => ["pageTitle", "sectionHeading", "mainContent", "content"].includes(item.importance));

  return compactObject({
    page: pick(snapshot.page, ["url", "origin", "title", "language", "metaDescription", "canonicalUrl"]),
    viewport: pick(snapshot.viewport, ["width", "height", "scrollX", "scrollY", "documentWidth", "documentHeight"]),
    headings: (content.headings || []).slice(0, 80).map((item) => compactObject({ level: item.level, text: item.text, selector: item.selector, bounds: compactBounds(item.bounds) })),
    landmarks: (content.landmarks || []).slice(0, 60).map((item) => compactObject({ role: item.role, label: item.label, textPreview: item.textPreview, selector: item.selector, bounds: compactBounds(item.bounds) })),
    interactiveElements: (content.interactiveElements || []).slice(0, 180).map((item) => compactObject({
      snapshotId: item.snapshotId,
      tag: item.tag,
      role: item.role,
      type: item.type,
      name: item.name,
      label: item.label,
      text: item.text,
      href: item.href,
      disabled: item.disabled,
      required: item.required,
      checked: item.checked,
      expanded: item.expanded,
      hasPopup: item.hasPopup,
      controls: item.controls,
      placeholder: item.placeholder,
      selector: item.selector,
      bounds: compactBounds(item.bounds)
    })),
    forms: (content.forms || []).slice(0, 20),
    links: (content.links || []).slice(0, 160),
    textBlocks: textBlocks.slice(0, 160).map((item) => compactObject({ tag: item.tag, role: item.role, text: item.text, importance: item.importance, selector: item.selector, bounds: compactBounds(item.bounds) }))
  });
}

async function createGuidancePlan({ provider, apiKey, model, taskRequest, planningPayload, previousSession }) {
  if (provider === "openai") {
    return createOpenAiGuidancePlan({ apiKey, model, taskRequest, planningPayload, previousSession });
  }
  return createGeminiGuidancePlan({ apiKey, model, taskRequest, planningPayload, previousSession });
}

async function createGeminiGuidancePlan({ apiKey, model, taskRequest, planningPayload, previousSession }) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: [
            "Create or refresh a guide-only browser assistance plan.",
            "Return only JSON that follows the provided schema.",
            "Never ask the extension to click, type, submit, purchase, delete, or confirm for the user.",
            "Each step must point to one primary target from the current planning payload.",
            "Use risk=high for checkout, payment, personal information submission, account deletion, or destructive actions.",
            "If previousSession is present, continue the user's same-tab task from the new page evidence.",
            "Use empty strings for unknown optional target or completion fields.",
            "",
            JSON.stringify({ taskRequest, previousSession, planningPayload })
          ].join("\n")
        }]
      }],
      generationConfig: {
        maxOutputTokens: 2400,
        responseMimeType: "application/json",
        responseSchema: guidancePlanSchema()
      }
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `Gemini request failed with HTTP ${response.status}.`);

  const rawText = extractResponseText(data);
  if (!rawText) throw new Error("Model returned no guidance plan text.");

  let plan;
  try {
    plan = JSON.parse(rawText);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }
  return validateGuidancePlan(plan);
}

async function createOpenAiGuidancePlan({ apiKey, model, taskRequest, planningPayload, previousSession }) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      instructions: [
        "Create or refresh a guide-only browser assistance plan.",
        "Return only JSON that follows the provided schema.",
        "Never ask the extension to click, type, submit, purchase, delete, or confirm for the user.",
        "Each step must point to one primary target from the current planning payload.",
        "Use risk=high for checkout, payment, personal information submission, account deletion, or destructive actions.",
        "If previousSession is present, continue the user's same-tab task from the new page evidence.",
        "Use empty strings for unknown optional target or completion fields."
      ].join(" "),
      input: JSON.stringify({ taskRequest, previousSession, planningPayload }),
      text: {
        format: {
          type: "json_schema",
          name: "guidance_plan",
          strict: true,
          schema: openAiGuidancePlanSchema()
        }
      },
      max_output_tokens: 2400
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error?.message || `OpenAI request failed with HTTP ${response.status}.`);

  const rawText = extractOpenAiResponseText(data);
  if (!rawText) throw new Error("Model returned no guidance plan text.");

  let plan;
  try {
    plan = JSON.parse(rawText);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }
  return validateGuidancePlan(plan);
}

function extractResponseText(response) {
  const chunks = [];
  for (const candidate of response?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("").trim();
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

function validateGuidancePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("Guidance plan must be an object.");
  if (typeof plan.summary !== "string" || !plan.summary.trim()) throw new Error("Guidance plan summary is missing.");
  if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error("Guidance plan must include at least one step.");

  return {
    summary: plan.summary.trim(),
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.filter((item) => typeof item === "string" && item.trim()).slice(0, 5) : [],
    steps: plan.steps.map((step, index) => {
      if (!step || typeof step !== "object") throw new Error(`Step ${index + 1} is invalid.`);
      if (typeof step.title !== "string" || !step.title.trim()) throw new Error(`Step ${index + 1} is missing a title.`);
      if (typeof step.instruction !== "string" || !step.instruction.trim()) throw new Error(`Step ${index + 1} is missing an instruction.`);
      if (!step.target || typeof step.target !== "object") throw new Error(`Step ${index + 1} is missing a target.`);
      return {
        id: typeof step.id === "string" && step.id.trim() ? step.id : `step-${index + 1}`,
        title: step.title.trim(),
        instruction: step.instruction.trim(),
        target: normalizeTarget(step.target),
        completion: normalizeCompletion(step.completion),
        risk: ["low", "medium", "high"].includes(step.risk) ? step.risk : "low"
      };
    })
  };
}

function normalizeTarget(target) {
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
    bounds: target.bounds && typeof target.bounds === "object" ? target.bounds : null
  };
}

function normalizeCompletion(completion) {
  if (!completion || typeof completion !== "object") return { type: "manual", value: null };
  return {
    type: typeof completion.type === "string" && completion.type.trim() ? completion.type.trim() : "manual",
    value: completion.value == null ? null : String(completion.value)
  };
}

function stringOrNull(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function compactBounds(bounds) {
  if (!bounds) return null;
  return compactObject({ x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, inViewport: bounds.inViewport });
}

function pick(source, keys) {
  const target = {};
  for (const key of keys) target[key] = source?.[key];
  return compactObject(target);
}

function compactObject(object) {
  return Object.fromEntries(Object.entries(object || {}).filter(([, value]) => value !== undefined && value !== null && value !== ""));
}

function guidancePlanSchema() {
  const optionalString = { type: "string" };
  return {
    type: "object",
    required: ["summary", "assumptions", "steps"],
    properties: {
      summary: { type: "string" },
      assumptions: { type: "array", items: { type: "string" } },
      steps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "title", "instruction", "target", "completion", "risk"],
          properties: {
            id: { type: "string" },
            title: { type: "string" },
            instruction: { type: "string" },
            risk: { type: "string", enum: ["low", "medium", "high"] },
            target: {
              type: "object",
              required: ["snapshotId", "kind", "role", "label", "text", "selector", "href", "name", "type", "placeholder"],
              properties: {
                snapshotId: optionalString,
                kind: optionalString,
                role: optionalString,
                label: optionalString,
                text: optionalString,
                selector: optionalString,
                href: optionalString,
                name: optionalString,
                type: optionalString,
                placeholder: optionalString
              }
            },
            completion: {
              type: "object",
              required: ["type", "value"],
              properties: {
                type: { type: "string", enum: ["manual", "click", "inputChanged", "inputValueEquals", "checked", "urlChanged", "dialogAppears"] },
                value: optionalString
              }
            }
          }
        }
      }
    }
  };
}

function openAiGuidancePlanSchema() {
  const stringField = { type: "string" };
  return {
    type: "object",
    additionalProperties: false,
    required: ["summary", "assumptions", "steps"],
    properties: {
      summary: stringField,
      assumptions: { type: "array", items: stringField },
      steps: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "title", "instruction", "target", "completion", "risk"],
          properties: {
            id: stringField,
            title: stringField,
            instruction: stringField,
            risk: { type: "string", enum: ["low", "medium", "high"] },
            target: {
              type: "object",
              additionalProperties: false,
              required: ["snapshotId", "kind", "role", "label", "text", "selector", "href", "name", "type", "placeholder"],
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
                placeholder: stringField
              }
            },
            completion: {
              type: "object",
              additionalProperties: false,
              required: ["type", "value"],
              properties: {
                type: { type: "string", enum: ["manual", "click", "inputChanged", "inputValueEquals", "checked", "urlChanged", "dialogAppears"] },
                value: stringField
              }
            }
          }
        }
      }
    }
  };
}

function collectPageSnapshotForGuide() {
  const MAX_TEXT_LENGTH = 600;
  const pageUrl = location.href;
  const interactiveSelector = "a[href],button,input,select,textarea,summary,[role],[tabindex]:not([tabindex='-1']),[contenteditable='true']";
  const textBlockSelector = "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,caption,label,legend,dt,dd,th,td,[role='heading'],[aria-label]";

  return {
    schemaVersion: "0.1.0",
    collectedAt: new Date().toISOString(),
    page: {
      url: pageUrl,
      origin: location.origin,
      title: document.title,
      language: document.documentElement.lang || null,
      canonicalUrl: document.querySelector("link[rel='canonical']")?.href || null,
      metaDescription: document.querySelector("meta[name='description'], meta[property='description']")?.getAttribute("content") || null
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight
    },
    content: {
      landmarks: Array.from(document.querySelectorAll("header,nav,main,aside,footer,section,article,form,[role='banner'],[role='navigation'],[role='main'],[role='complementary'],[role='contentinfo'],[role='search'],[role='region']")).filter(isVisible).slice(0, 120).map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: getRole(element),
        label: getAccessibleName(element),
        textPreview: truncate(element.innerText || element.textContent || "", 220),
        selector: getCssPath(element),
        bounds: getBounds(element)
      })),
      headings: Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).filter(isVisible).slice(0, 120).map((element) => ({
        level: getHeadingLevel(element),
        text: truncate(getElementText(element), MAX_TEXT_LENGTH),
        selector: getCssPath(element),
        bounds: getBounds(element)
      })),
      textBlocks: Array.from(document.querySelectorAll(textBlockSelector)).filter(isVisible).map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: getRole(element),
        text: truncate(getElementText(element) || getAccessibleName(element), MAX_TEXT_LENGTH),
        selector: getCssPath(element),
        bounds: getBounds(element),
        importance: inferImportance(element)
      })).filter((item) => item.text).slice(0, 300),
      interactiveElements: Array.from(document.querySelectorAll(interactiveSelector)).filter(isVisible).map((element, index) => ({
        snapshotId: `interactive-${index + 1}`,
        tag: element.tagName.toLowerCase(),
        role: getRole(element),
        type: element.getAttribute("type") || (element.tagName.toLowerCase() === "input" ? "text" : null),
        name: element.getAttribute("name") || null,
        label: getAccessibleName(element),
        text: truncate(getElementText(element), MAX_TEXT_LENGTH),
        href: element instanceof HTMLAnchorElement ? element.href : null,
        disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
        required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
        checked: ["checkbox", "radio"].includes(element.getAttribute("type")) ? Boolean(element.checked) : null,
        expanded: element.getAttribute("aria-expanded"),
        hasPopup: element.getAttribute("aria-haspopup"),
        controls: element.getAttribute("aria-controls"),
        placeholder: element.matches("input,select,textarea") ? element.getAttribute("placeholder") : null,
        selector: getCssPath(element),
        bounds: getBounds(element)
      })).slice(0, 250),
      forms: Array.from(document.forms).slice(0, 20).map((form, index) => ({
        snapshotId: `form-${index + 1}`,
        label: getAccessibleName(form),
        selector: getCssPath(form),
        method: (form.getAttribute("method") || "get").toLowerCase(),
        actionOrigin: safeOrigin(form.action),
        bounds: getBounds(form),
        fields: Array.from(form.querySelectorAll("input, select, textarea, button")).map((field, fieldIndex) => ({
          snapshotId: `form-${index + 1}-field-${fieldIndex + 1}`,
          tag: field.tagName.toLowerCase(),
          type: field.getAttribute("type") || (field.tagName.toLowerCase() === "input" ? "text" : null),
          name: field.getAttribute("name") || null,
          label: getAccessibleName(field),
          placeholder: field.getAttribute("placeholder") || null,
          required: Boolean(field.required || field.getAttribute("aria-required") === "true"),
          disabled: Boolean(field.disabled || field.getAttribute("aria-disabled") === "true"),
          readonly: Boolean(field.readOnly),
          valueIncluded: false,
          selector: getCssPath(field),
          bounds: getBounds(field)
        }))
      })),
      links: Array.from(document.links).filter(isVisible).map((link) => ({
        text: truncate(getElementText(link) || getAccessibleName(link), MAX_TEXT_LENGTH),
        href: link.href,
        sameOrigin: safeOrigin(link.href) === location.origin,
        selector: getCssPath(link),
        bounds: getBounds(link)
      })).filter((link) => link.text || link.href).slice(0, 250)
    }
  };

  function getAccessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return truncate(ariaLabel, MAX_TEXT_LENGTH);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map(getElementText).join(" ");
      if (text) return truncate(text, MAX_TEXT_LENGTH);
    }
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return truncate(getElementText(label), MAX_TEXT_LENGTH);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return truncate(getElementText(wrappingLabel), MAX_TEXT_LENGTH);
    return truncate(element.getAttribute("title") || element.getAttribute("alt") || "", MAX_TEXT_LENGTH) || null;
  }

  function getElementText(element) {
    return normalizeText(element?.innerText || element?.textContent || "");
  }

  function getRole(element) {
    const tag = element.tagName.toLowerCase();
    return element.getAttribute("role") || ({ a: "link", button: "button", nav: "navigation", main: "main", header: "banner", footer: "contentinfo", aside: "complementary", form: "form", select: "combobox", textarea: "textbox" }[tag]) || (/^h[1-6]$/.test(tag) ? "heading" : tag === "input" ? "textbox" : null);
  }

  function getHeadingLevel(element) {
    const ariaLevel = Number(element.getAttribute("aria-level"));
    if (Number.isInteger(ariaLevel) && ariaLevel > 0) return ariaLevel;
    const match = element.tagName.match(/^H([1-6])$/i);
    return match ? Number(match[1]) : null;
  }

  function inferImportance(element) {
    const tag = element.tagName.toLowerCase();
    if (tag === "h1") return "pageTitle";
    if (tag === "h2" || tag === "h3" || element.getAttribute("role") === "heading") return "sectionHeading";
    if (element.closest("nav")) return "navigation";
    if (element.closest("main")) return "mainContent";
    if (element.closest("footer")) return "footer";
    return "content";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function getBounds(element) {
    const rect = element.getBoundingClientRect();
    return { x: round(rect.x), y: round(rect.y), width: round(rect.width), height: round(rect.height), inViewport: rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth };
  }

  function getCssPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.id) return `#${cssEscape(element.id)}`;
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const classNames = Array.from(current.classList).slice(0, 2);
      if (classNames.length) part += `.${classNames.map(cssEscape).join(".")}`;
      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (sameTagSiblings.length > 1) part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      if (parts.length >= 5) break;
      current = parent;
    }
    return parts.join(" > ");
  }

  function safeOrigin(url) {
    try {
      return new URL(url, pageUrl).origin;
    } catch {
      return null;
    }
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function truncate(text, maxLength) {
    const normalized = normalizeText(text);
    return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1)}...`;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

function installGuidedTaskOverlay(plan, options = {}) {
  const ROOT_ID = "bridge-guided-task-root";
  const HIGHLIGHT_ID = "bridge-guided-task-highlight";
  const STYLE_ID = "bridge-guided-task-style";
  const ACTIVE_CLASS = "bridge-guided-task-active-target";
  let currentIndex = Math.max(0, Math.min(options.currentStepIndex || 0, plan.steps.length));
  let currentTarget = null;
  let riskAccepted = false;

  cleanupExistingGuide();
  installStyles();

  const root = document.createElement("div");
  root.id = ROOT_ID;
  root.setAttribute("role", "region");
  root.setAttribute("aria-label", "Guided Task Mode");
  document.documentElement.append(root);

  const highlight = document.createElement("div");
  highlight.id = HIGHLIGHT_ID;
  document.documentElement.append(highlight);

  window.__bridgeGuidedTaskCleanup = endGuide;
  window.addEventListener("resize", positionOverlay);
  window.addEventListener("scroll", positionOverlay, true);
  document.addEventListener("click", onPageClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  renderStep(options.message || "");

  function renderStep(message = "") {
    const step = plan.steps[currentIndex];
    if (!step) return renderFinished();
    clearTarget();
    riskAccepted = step.risk !== "high";
    currentTarget = resolveTarget(step.target);
    if (currentTarget) {
      currentTarget.classList.add(ACTIVE_CLASS);
      currentTarget.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }
    root.innerHTML = panelHtml(step, message);
    bindButtons();
    setTimeout(positionOverlay, 250);
    notifyProgress();
  }

  function panelHtml(step, message) {
    const isHighRisk = step.risk === "high" && !riskAccepted;
    return `
      <section class="bridge-guide-panel">
        <div class="bridge-guide-kicker">Guided Task Mode</div>
        <h2>${escapeHtml(step.title)}</h2>
        <p class="bridge-guide-summary">${escapeHtml(plan.summary || "")}</p>
        ${isHighRisk ? `<div class="bridge-guide-risk"><strong>Review before acting.</strong><span>This step may have sensitive or hard-to-undo consequences. The extension will not perform the action for you.</span></div>` : ""}
        <p class="bridge-guide-instruction">${escapeHtml(step.instruction)}</p>
        ${currentTarget ? "" : `<p class="bridge-guide-warning">Target not found. Continue manually or wait for the refreshed page guide.</p>`}
        ${message ? `<p class="bridge-guide-message">${escapeHtml(message)}</p>` : ""}
        <div class="bridge-guide-progress">Step ${currentIndex + 1} of ${plan.steps.length}</div>
        <div class="bridge-guide-actions">
          <button type="button" data-bridge-action="back" ${currentIndex === 0 ? "disabled" : ""}>Back</button>
          ${isHighRisk ? `<button type="button" data-bridge-action="accept-risk">Continue</button>` : `<button type="button" data-bridge-action="next">Next</button>`}
          <button type="button" data-bridge-action="end">End</button>
        </div>
      </section>
    `;
  }

  function bindButtons() {
    root.querySelectorAll("[data-bridge-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.bridgeAction;
        if (action === "back") goTo(currentIndex - 1);
        if (action === "next") goTo(currentIndex + 1, plan.steps[currentIndex]?.title);
        if (action === "accept-risk") {
          riskAccepted = true;
          root.innerHTML = panelHtml(plan.steps[currentIndex], "Risk gate acknowledged. Complete the action on the original page when ready.");
          bindButtons();
          positionOverlay();
        }
        if (action === "end") endGuide(true);
      });
    });
  }

  function goTo(index, completedStep = "") {
    currentIndex = Math.max(0, Math.min(index, plan.steps.length));
    notifyProgress(completedStep);
    renderStep();
  }

  function onPageClick(event) {
    if (currentTarget && currentTarget.contains(event.target)) maybeComplete("click");
  }

  function onInput(event) {
    if (currentTarget && currentTarget.contains(event.target)) maybeComplete("inputChanged", event.target);
  }

  function maybeComplete(eventType, eventTarget = null) {
    const step = plan.steps[currentIndex];
    if (!step || (step.risk === "high" && !riskAccepted)) return;
    const completion = step.completion || { type: "manual" };
    if (completion.type === "click" && eventType === "click") goTo(currentIndex + 1, step.title);
    if (completion.type === "inputChanged" && eventType === "inputChanged") goTo(currentIndex + 1, step.title);
    if (completion.type === "inputValueEquals" && eventTarget && String(eventTarget.value || "").trim() === String(completion.value || "").trim()) goTo(currentIndex + 1, step.title);
    if (completion.type === "checked" && eventTarget?.checked) goTo(currentIndex + 1, step.title);
  }

  function notifyProgress(completedStep = "") {
    try {
      chrome.runtime.sendMessage({ type: "BRIDGE_GUIDE_PROGRESS", currentStepIndex: currentIndex, completedStep });
    } catch {}
  }

  function resolveTarget(target) {
    const bySelector = findBySelector(target.selector);
    if (bySelector) return bySelector;
    const candidates = Array.from(document.querySelectorAll("a[href],button,input,select,textarea,summary,[role],[tabindex]:not([tabindex='-1']),h1,h2,h3,h4,h5,h6,p,li,label")).filter(isVisible);
    let best = null;
    let bestScore = 4;
    for (const element of candidates) {
      const score = scoreTarget(element, target);
      if (score > bestScore) {
        best = element;
        bestScore = score;
      }
    }
    return best;
  }

  function findBySelector(selector) {
    if (!selector) return null;
    try {
      const element = document.querySelector(selector);
      return element && isVisible(element) ? element : null;
    } catch {
      return null;
    }
  }

  function scoreTarget(element, target) {
    let score = 0;
    const text = normalize(getElementText(element));
    const label = normalize(getAccessibleName(element));
    const role = normalize(getRole(element));
    if (target.role && role === normalize(target.role)) score += 3;
    if (target.label && label && includesEither(label, target.label)) score += 5;
    if (target.text && text && includesEither(text, target.text)) score += 5;
    if (target.name && normalize(element.getAttribute("name")) === normalize(target.name)) score += 4;
    if (target.placeholder && includesEither(element.getAttribute("placeholder"), target.placeholder)) score += 4;
    if (target.href && element instanceof HTMLAnchorElement && element.href === target.href) score += 5;
    return score;
  }

  function positionOverlay() {
    const rect = currentTarget?.getBoundingClientRect();
    highlight.style.display = rect ? "block" : "none";
    if (rect) {
      highlight.style.left = `${Math.max(8, rect.left - 6)}px`;
      highlight.style.top = `${Math.max(8, rect.top - 6)}px`;
      highlight.style.width = `${Math.max(24, rect.width + 12)}px`;
      highlight.style.height = `${Math.max(24, rect.height + 12)}px`;
    }
    const panel = root.querySelector(".bridge-guide-panel");
    if (!panel) return;
    if (!rect) {
      panel.style.left = "20px";
      panel.style.top = "20px";
      return;
    }
    const panelWidth = Math.min(360, window.innerWidth - 32);
    panel.style.left = `${Math.min(Math.max(16, rect.left), window.innerWidth - panelWidth - 16)}px`;
    panel.style.top = `${rect.bottom + panel.offsetHeight + 16 < window.innerHeight ? rect.bottom + 16 : Math.max(16, rect.top - panel.offsetHeight - 16)}px`;
  }

  function renderFinished() {
    clearTarget();
    highlight.style.display = "none";
    root.innerHTML = `<section class="bridge-guide-panel"><div class="bridge-guide-kicker">Guided Task Mode</div><h2>Guide complete</h2><p class="bridge-guide-instruction">The guidance plan is finished.</p><div class="bridge-guide-actions"><button type="button" data-bridge-action="end">Close</button></div></section>`;
    bindButtons();
    positionOverlay();
  }

  function clearTarget() {
    if (currentTarget) currentTarget.classList.remove(ACTIVE_CLASS);
    currentTarget = null;
  }

  function endGuide(notify = false) {
    clearTarget();
    window.removeEventListener("resize", positionOverlay);
    window.removeEventListener("scroll", positionOverlay, true);
    document.removeEventListener("click", onPageClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    if (window.__bridgeGuidedTaskCleanup === endGuide) window.__bridgeGuidedTaskCleanup = null;
    if (notify) {
      try {
        chrome.runtime.sendMessage({ type: "BRIDGE_END_GUIDE" });
      } catch {}
    }
  }

  function cleanupExistingGuide() {
    if (typeof window.__bridgeGuidedTaskCleanup === "function") window.__bridgeGuidedTaskCleanup();
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((element) => element.classList.remove(ACTIVE_CLASS));
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID}{position:fixed;inset:0;z-index:2147483646;pointer-events:none;font:14px/1.4 system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17202a}
      #${HIGHLIGHT_ID}{position:fixed;z-index:2147483645;pointer-events:none;border:4px solid #1769aa;border-radius:8px;box-shadow:0 0 0 9999px rgba(23,32,42,.18),0 0 0 8px rgba(23,105,170,.20);transition:left 140ms ease,top 140ms ease,width 140ms ease,height 140ms ease}
      .${ACTIVE_CLASS}{scroll-margin:120px}
      .bridge-guide-panel{position:fixed;width:min(360px,calc(100vw - 32px));pointer-events:auto;background:#fff;border:1px solid #d9dee7;border-radius:8px;box-shadow:0 12px 32px rgba(23,32,42,.28);padding:14px}
      .bridge-guide-kicker{color:#1769aa;font-size:12px;font-weight:800;text-transform:uppercase}
      .bridge-guide-panel h2{margin:4px 0 8px;font-size:18px;line-height:1.2}
      .bridge-guide-summary,.bridge-guide-instruction,.bridge-guide-warning,.bridge-guide-message,.bridge-guide-progress{margin:8px 0}
      .bridge-guide-summary,.bridge-guide-progress{color:#5d6978;font-size:12px}
      .bridge-guide-warning{color:#b3261e;font-weight:700}.bridge-guide-message{color:#0f4f82}
      .bridge-guide-risk{display:grid;gap:4px;margin:10px 0;border:1px solid #f1b8b4;border-radius:6px;background:#fff4f3;color:#6f1711;padding:10px}
      .bridge-guide-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin-top:12px}
      .bridge-guide-actions button{min-height:34px;border:1px solid #1769aa;border-radius:6px;background:#1769aa;color:#fff;cursor:pointer;font:inherit;font-size:12px}
      .bridge-guide-actions button:disabled{border-color:#d9dee7;background:#e6e9ef;color:#8792a1;cursor:not-allowed}
    `;
    document.documentElement.append(style);
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function getAccessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return getElementText(label);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return getElementText(wrappingLabel);
    return element.getAttribute("title") || element.getAttribute("alt") || "";
  }

  function getRole(element) {
    const tag = element.tagName.toLowerCase();
    return element.getAttribute("role") || ({ a: "link", button: "button", input: "textbox", select: "combobox", textarea: "textbox" }[tag]) || (/^h[1-6]$/.test(tag) ? "heading" : "");
  }

  function getElementText(element) {
    return String(element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  function includesEither(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    return Boolean(a && b && (a.includes(b) || b.includes(a)));
  }

  function normalize(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char]);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

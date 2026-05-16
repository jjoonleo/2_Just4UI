const extractButton = document.getElementById("extractButton");
const includeScreenshot = document.getElementById("includeScreenshot");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const copyButton = document.getElementById("copyButton");
const downloadButton = document.getElementById("downloadButton");
const textCountEl = document.getElementById("textCount");
const interactiveCountEl = document.getElementById("interactiveCount");
const formCountEl = document.getElementById("formCount");
const imageCountEl = document.getElementById("imageCount");
const providerSelect = document.getElementById("providerSelect");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const apiKeyInput = document.getElementById("apiKeyInput");
const modelInput = document.getElementById("modelInput");
const taskRequestInput = document.getElementById("taskRequestInput");
const startGuideButton = document.getElementById("startGuideButton");
const clearKeyButton = document.getElementById("clearKeyButton");

const GUIDE_STORAGE_KEYS = {
  provider: "bridgeModelProvider",
  geminiApiKey: "bridgeGeminiApiKey",
  geminiModel: "bridgeGeminiModel",
  openAiApiKey: "bridgeOpenAiApiKey",
  openAiModel: "bridgeOpenAiModel"
};

const PROVIDER_DEFAULTS = {
  gemini: {
    label: "Gemini API key",
    placeholder: "AIza...",
    model: "gemini-2.5-flash",
    apiKeyStorageKey: GUIDE_STORAGE_KEYS.geminiApiKey,
    modelStorageKey: GUIDE_STORAGE_KEYS.geminiModel
  },
  openai: {
    label: "OpenAI API key",
    placeholder: "sk-...",
    model: "gpt-4.1-mini",
    apiKeyStorageKey: GUIDE_STORAGE_KEYS.openAiApiKey,
    modelStorageKey: GUIDE_STORAGE_KEYS.openAiModel
  }
};

let latestSnapshotJson = "";

extractButton.addEventListener("click", extractCurrentPage);
copyButton.addEventListener("click", copySnapshot);
downloadButton.addEventListener("click", downloadSnapshot);
startGuideButton.addEventListener("click", startGuidedTaskMode);
clearKeyButton.addEventListener("click", clearStoredApiKey);
providerSelect.addEventListener("change", updateProviderFields);

restoreGuideSettings();

async function restoreGuideSettings() {
  const stored = await chrome.storage.local.get(Object.values(GUIDE_STORAGE_KEYS));
  providerSelect.value = stored[GUIDE_STORAGE_KEYS.provider] || "gemini";
  applyProviderFields(stored);
}

async function clearStoredApiKey() {
  const provider = getSelectedProvider();
  await chrome.storage.local.remove(PROVIDER_DEFAULTS[provider].apiKeyStorageKey);
  apiKeyInput.value = "";
  setStatus(`Stored ${PROVIDER_DEFAULTS[provider].label} cleared.`);
}

async function updateProviderFields() {
  const provider = getSelectedProvider();
  await chrome.storage.local.set({ [GUIDE_STORAGE_KEYS.provider]: provider });
  const stored = await chrome.storage.local.get(Object.values(GUIDE_STORAGE_KEYS));
  applyProviderFields(stored);
}

function applyProviderFields(stored = {}) {
  const provider = getSelectedProvider();
  const config = PROVIDER_DEFAULTS[provider];
  apiKeyLabel.textContent = config.label;
  apiKeyInput.placeholder = config.placeholder;
  apiKeyInput.value = stored[config.apiKeyStorageKey] || "";
  modelInput.value = stored[config.modelStorageKey] || config.model;
}

function getSelectedProvider() {
  return providerSelect.value === "openai" ? "openai" : "gemini";
}

async function extractCurrentPage() {
  setBusy(true);
  setStatus("Extracting page snapshot...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    const snapshot = await extractSnapshotFromTab(tab.id);
    if (includeScreenshot.checked) {
      setStatus("Capturing visible screenshot...");
      snapshot.visualSnapshot = {
        kind: "visibleViewportScreenshot",
        format: "png",
        dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      };
    }

    latestSnapshotJson = JSON.stringify(snapshot, null, 2);
    outputEl.value = latestSnapshotJson;
    updateSummary(snapshot);
    copyButton.disabled = false;
    downloadButton.disabled = false;
    setStatus("Snapshot extracted.");
  } catch (error) {
    latestSnapshotJson = "";
    outputEl.value = "";
    copyButton.disabled = true;
    downloadButton.disabled = true;
    updateSummary(null);
    setStatus(error.message || "Failed to extract snapshot.", true);
  } finally {
    setBusy(false);
  }
}

async function startGuidedTaskMode() {
  const provider = getSelectedProvider();
  const providerConfig = PROVIDER_DEFAULTS[provider];
  const taskRequest = taskRequestInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim() || providerConfig.model;

  if (!taskRequest) {
    setStatus("Enter a task request first.", true);
    taskRequestInput.focus();
    return;
  }

  if (!apiKey) {
    setStatus(`Enter a ${providerConfig.label} for the prototype.`, true);
    apiKeyInput.focus();
    return;
  }

  setBusy(true, "Planning guide...");
  setStatus("Extracting page snapshot for guidance...");

  try {
    await chrome.storage.local.set({
      [GUIDE_STORAGE_KEYS.provider]: provider,
      [providerConfig.apiKeyStorageKey]: apiKey,
      [providerConfig.modelStorageKey]: model
    });

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    setStatus(`Creating guidance plan with ${provider === "openai" ? "OpenAI" : "Gemini"}...`);
    const response = await chrome.runtime.sendMessage({
      type: "BRIDGE_START_GUIDE",
      tabId: tab.id,
      provider,
      taskRequest,
      model
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Failed to start Guided Task Mode.");
    }

    setStatus("Guided Task Mode started. It will follow the active tab in this window.");
  } catch (error) {
    setStatus(error.message || "Failed to start Guided Task Mode.", true);
  } finally {
    setBusy(false);
  }
}

async function extractSnapshotFromTab(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPageSnapshot
  });
  return result;
}

async function copySnapshot() {
  if (!latestSnapshotJson) return;
  await navigator.clipboard.writeText(latestSnapshotJson);
  setStatus("Snapshot JSON copied.");
}

function downloadSnapshot() {
  if (!latestSnapshotJson) return;

  const blob = new Blob([latestSnapshotJson], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `page-snapshot-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Snapshot JSON downloaded.");
}

function setBusy(isBusy, busyText = "Extracting...") {
  extractButton.disabled = isBusy;
  startGuideButton.disabled = isBusy;
  clearKeyButton.disabled = isBusy;
  extractButton.textContent = isBusy ? busyText : "Extract current page";
  startGuideButton.textContent = isBusy ? "Working..." : "Start guide";
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function updateSummary(snapshot) {
  textCountEl.textContent = String(snapshot?.content?.textBlocks?.length || 0);
  interactiveCountEl.textContent = String(snapshot?.content?.interactiveElements?.length || 0);
  formCountEl.textContent = String(snapshot?.content?.forms?.length || 0);
  imageCountEl.textContent = String(snapshot?.content?.images?.length || 0);
}

function createPlanningPayload(snapshot) {
  const content = snapshot.content || {};
  const mainText = (content.textBlocks || []).filter((item) => ["pageTitle", "sectionHeading", "mainContent", "content"].includes(item.importance));

  return compactObject({
    page: pick(snapshot.page, ["url", "origin", "title", "language", "metaDescription", "canonicalUrl"]),
    viewport: pick(snapshot.viewport, ["width", "height", "scrollX", "scrollY", "documentWidth", "documentHeight"]),
    headings: (content.headings || []).filter((item) => item.visible !== false).slice(0, 80).map((item) => compactObject({
      level: item.level,
      text: item.text,
      selector: item.selector,
      bounds: compactBounds(item.bounds)
    })),
    landmarks: (content.landmarks || []).filter((item) => item.visible !== false).slice(0, 60).map((item) => compactObject({
      role: item.role,
      label: item.label,
      textPreview: item.textPreview,
      selector: item.selector,
      bounds: compactBounds(item.bounds)
    })),
    interactiveElements: (content.interactiveElements || []).filter((item) => item.visible !== false).slice(0, 180).map((item) => compactObject({
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
    forms: (content.forms || []).slice(0, 20).map((form) => compactObject({
      snapshotId: form.snapshotId,
      label: form.label,
      method: form.method,
      actionOrigin: form.actionOrigin,
      selector: form.selector,
      bounds: compactBounds(form.bounds),
      fields: (form.fields || []).filter((field) => field.visible !== false).slice(0, 60).map((field) => compactObject({
        snapshotId: field.snapshotId,
        tag: field.tag,
        type: field.type,
        name: field.name,
        label: field.label,
        placeholder: field.placeholder,
        required: field.required,
        disabled: field.disabled,
        readonly: field.readonly,
        options: field.options,
        selector: field.selector,
        bounds: compactBounds(field.bounds)
      }))
    })),
    links: (content.links || []).slice(0, 160).map((item) => compactObject({
      text: item.text,
      href: item.href,
      sameOrigin: item.sameOrigin,
      selector: item.selector,
      bounds: compactBounds(item.bounds)
    })),
    images: (content.images || []).slice(0, 60).map((item) => compactObject({
      alt: item.alt,
      title: item.title,
      src: item.src,
      displayedWidth: item.displayedWidth,
      displayedHeight: item.displayedHeight,
      selector: item.selector,
      bounds: compactBounds(item.bounds)
    })),
    textBlocks: mainText.slice(0, 160).map((item) => compactObject({
      tag: item.tag,
      role: item.role,
      text: item.text,
      importance: item.importance,
      selector: item.selector,
      bounds: compactBounds(item.bounds)
    }))
  });
}

async function createGuidancePlan({ apiKey, model, taskRequest, planningPayload }) {
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
            "Create a guide-only browser assistance plan.",
            "Return only JSON that follows the provided schema.",
            "Never ask the extension to click, type, submit, purchase, delete, or confirm for the user.",
            "Each step must point to one primary target from the planning payload.",
            "Use risk=high for checkout, payment, personal information submission, account deletion, or destructive actions.",
            "Prefer selectors and snapshotIds from the payload when available.",
            "Use empty strings for unknown optional target or completion fields.",
            "",
            JSON.stringify({ taskRequest, planningPayload })
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
  if (!response.ok) {
    throw new Error(data?.error?.message || `Gemini request failed with HTTP ${response.status}.`);
  }

  const rawText = extractResponseText(data);
  if (!rawText) {
    throw new Error("Model returned no guidance plan text.");
  }

  let plan;
  try {
    plan = JSON.parse(rawText);
  } catch {
    throw new Error("Model returned invalid JSON.");
  }

  return validateGuidancePlan(plan);
}

function extractResponseText(response) {
  if (typeof response?.text === "string") return response.text;
  const chunks = [];
  for (const candidate of response?.candidates || []) {
    for (const part of candidate.content?.parts || []) {
      if (typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("").trim();
}

function validateGuidancePlan(plan) {
  if (!plan || typeof plan !== "object") throw new Error("Guidance plan must be an object.");
  if (typeof plan.summary !== "string" || !plan.summary.trim()) throw new Error("Guidance plan summary is missing.");
  if (!Array.isArray(plan.steps) || !plan.steps.length) throw new Error("Guidance plan must include at least one step.");

  const normalizedSteps = plan.steps.map((step, index) => {
    if (!step || typeof step !== "object") throw new Error(`Step ${index + 1} is invalid.`);
    if (typeof step.title !== "string" || !step.title.trim()) throw new Error(`Step ${index + 1} is missing a title.`);
    if (typeof step.instruction !== "string" || !step.instruction.trim()) throw new Error(`Step ${index + 1} is missing an instruction.`);
    if (!step.target || typeof step.target !== "object") throw new Error(`Step ${index + 1} is missing a target.`);
    const risk = ["low", "medium", "high"].includes(step.risk) ? step.risk : "low";
    return {
      id: typeof step.id === "string" && step.id.trim() ? step.id : `step-${index + 1}`,
      title: step.title.trim(),
      instruction: step.instruction.trim(),
      target: normalizeTarget(step.target),
      completion: normalizeCompletion(step.completion),
      risk
    };
  });

  return {
    summary: plan.summary.trim(),
    assumptions: Array.isArray(plan.assumptions) ? plan.assumptions.filter((item) => typeof item === "string" && item.trim()).slice(0, 5) : [],
    steps: normalizedSteps
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
  if (!completion || typeof completion !== "object") return { type: "manual" };
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
  return compactObject({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    inViewport: bounds.inViewport
  });
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

function collectPageSnapshot() {
  const MAX_TEXT_BLOCKS = 300;
  const MAX_INTERACTIVE_ELEMENTS = 250;
  const MAX_IMAGES = 150;
  const MAX_LINKS = 250;
  const MAX_TABLES = 50;
  const MAX_LISTS = 80;
  const MAX_OPTIONS = 30;
  const MAX_TEXT_LENGTH = 600;

  const interactiveSelector = [
    "a[href]",
    "button",
    "input",
    "select",
    "textarea",
    "summary",
    "[role]",
    "[tabindex]:not([tabindex='-1'])",
    "[contenteditable='true']"
  ].join(",");

  const textBlockSelector = [
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "li",
    "blockquote",
    "figcaption",
    "caption",
    "label",
    "legend",
    "dt",
    "dd",
    "th",
    "td",
    "[role='heading']",
    "[aria-label]"
  ].join(",");

  const pageUrl = location.href;

  return {
    schemaVersion: "0.1.0",
    collectedAt: new Date().toISOString(),
    privacy: {
      userTriggered: true,
      formValuesIncluded: false,
      automaticRetention: false,
      screenshotIncluded: false
    },
    page: {
      url: pageUrl,
      origin: location.origin,
      title: document.title,
      language: document.documentElement.lang || null,
      direction: document.documentElement.dir || getComputedStyle(document.documentElement).direction || null,
      charset: document.characterSet || null,
      canonicalUrl: getCanonicalUrl(),
      metaDescription: getMeta("description"),
      metaRobots: getMeta("robots")
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight
    },
    content: {
      landmarks: collectLandmarks(),
      headings: collectHeadings(),
      textBlocks: collectTextBlocks(),
      interactiveElements: collectInteractiveElements(),
      forms: collectForms(),
      links: collectLinks(),
      images: collectImages(),
      media: collectMedia(),
      tables: collectTables(),
      lists: collectLists(),
      dialogs: collectDialogs(),
      liveRegions: collectLiveRegions()
    }
  };

  function collectLandmarks() {
    const selectors = [
      "header",
      "nav",
      "main",
      "aside",
      "footer",
      "section",
      "article",
      "form",
      "[role='banner']",
      "[role='navigation']",
      "[role='main']",
      "[role='complementary']",
      "[role='contentinfo']",
      "[role='search']",
      "[role='region']"
    ].join(",");

    return Array.from(document.querySelectorAll(selectors)).slice(0, 120).map((element) => ({
      tag: element.tagName.toLowerCase(),
      role: getRole(element),
      label: getAccessibleName(element),
      textPreview: truncate(normalizeText(element.innerText || element.textContent || ""), 220),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectHeadings() {
    return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).slice(0, 120).map((element) => ({
      level: getHeadingLevel(element),
      text: truncate(getElementText(element), MAX_TEXT_LENGTH),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectTextBlocks() {
    return Array.from(document.querySelectorAll(textBlockSelector))
      .filter((element) => isVisible(element))
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        role: getRole(element),
        text: truncate(getElementText(element) || getAccessibleName(element), MAX_TEXT_LENGTH),
        selector: getCssPath(element),
        bounds: getBounds(element),
        importance: inferImportance(element)
      }))
      .filter((item) => item.text)
      .slice(0, MAX_TEXT_BLOCKS);
  }

  function collectInteractiveElements() {
    return Array.from(document.querySelectorAll(interactiveSelector))
      .filter((element) => isVisible(element))
      .map((element, index) => {
        const type = getInputType(element);
        return {
          snapshotId: `interactive-${index + 1}`,
          tag: element.tagName.toLowerCase(),
          role: getRole(element),
          type,
          name: getNameAttribute(element),
          label: getAccessibleName(element),
          text: truncate(getElementText(element), MAX_TEXT_LENGTH),
          href: element instanceof HTMLAnchorElement ? normalizeUrl(element.href) : null,
          disabled: Boolean(element.disabled || element.getAttribute("aria-disabled") === "true"),
          required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
          checked: isCheckable(element) ? Boolean(element.checked || element.getAttribute("aria-checked") === "true") : null,
          expanded: getNullableAttribute(element, "aria-expanded"),
          hasPopup: getNullableAttribute(element, "aria-haspopup"),
          controls: getNullableAttribute(element, "aria-controls"),
          describedBy: getDescribedByText(element),
          placeholder: isFormControl(element) ? element.getAttribute("placeholder") || null : null,
          valueIncluded: false,
          selector: getCssPath(element),
          bounds: getBounds(element),
          visible: true
        };
      })
      .slice(0, MAX_INTERACTIVE_ELEMENTS);
  }

  function collectForms() {
    return Array.from(document.forms).map((form, index) => ({
      snapshotId: `form-${index + 1}`,
      label: getAccessibleName(form),
      selector: getCssPath(form),
      method: (form.getAttribute("method") || "get").toLowerCase(),
      actionOrigin: safeOrigin(form.action),
      bounds: getBounds(form),
      visible: isVisible(form),
      fields: Array.from(form.querySelectorAll("input, select, textarea, button")).map((field, fieldIndex) => ({
        snapshotId: `form-${index + 1}-field-${fieldIndex + 1}`,
        tag: field.tagName.toLowerCase(),
        type: getInputType(field),
        name: getNameAttribute(field),
        label: getAccessibleName(field),
        placeholder: field.getAttribute("placeholder") || null,
        autocomplete: field.getAttribute("autocomplete") || null,
        required: Boolean(field.required || field.getAttribute("aria-required") === "true"),
        disabled: Boolean(field.disabled || field.getAttribute("aria-disabled") === "true"),
        readonly: Boolean(field.readOnly),
        options: field instanceof HTMLSelectElement ? collectSelectOptions(field) : null,
        valueIncluded: false,
        selector: getCssPath(field),
        bounds: getBounds(field),
        visible: isVisible(field)
      }))
    }));
  }

  function collectLinks() {
    return Array.from(document.links)
      .filter((link) => isVisible(link))
      .map((link) => ({
        text: truncate(getElementText(link) || getAccessibleName(link), MAX_TEXT_LENGTH),
        href: normalizeUrl(link.href),
        sameOrigin: safeOrigin(link.href) === location.origin,
        target: link.target || null,
        selector: getCssPath(link),
        bounds: getBounds(link)
      }))
      .filter((link) => link.text || link.href)
      .slice(0, MAX_LINKS);
  }

  function collectImages() {
    return Array.from(document.images)
      .filter((image) => isVisible(image))
      .map((image) => ({
        alt: image.alt || null,
        title: image.title || null,
        src: normalizeUrl(image.currentSrc || image.src),
        loading: image.loading || null,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
        displayedWidth: image.width,
        displayedHeight: image.height,
        selector: getCssPath(image),
        bounds: getBounds(image)
      }))
      .slice(0, MAX_IMAGES);
  }

  function collectMedia() {
    return Array.from(document.querySelectorAll("audio, video")).slice(0, 80).map((element) => ({
      tag: element.tagName.toLowerCase(),
      controls: Boolean(element.controls),
      autoplay: Boolean(element.autoplay),
      muted: Boolean(element.muted),
      duration: Number.isFinite(element.duration) ? element.duration : null,
      label: getAccessibleName(element),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectTables() {
    return Array.from(document.querySelectorAll("table")).slice(0, MAX_TABLES).map((table, index) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => truncate(getElementText(cell), 120)).filter(Boolean).slice(0, 30);
      return {
        snapshotId: `table-${index + 1}`,
        caption: getElementText(table.querySelector("caption")),
        headers,
        rowCount: table.rows.length,
        columnEstimate: Math.max(0, ...Array.from(table.rows).map((row) => row.cells.length)),
        selector: getCssPath(table),
        bounds: getBounds(table),
        visible: isVisible(table)
      };
    });
  }

  function collectLists() {
    return Array.from(document.querySelectorAll("ul,ol,[role='list']")).slice(0, MAX_LISTS).map((list, index) => ({
      snapshotId: `list-${index + 1}`,
      tag: list.tagName.toLowerCase(),
      role: getRole(list),
      itemCount: list.querySelectorAll(":scope > li, :scope > [role='listitem']").length,
      textPreview: truncate(getElementText(list), 300),
      selector: getCssPath(list),
      bounds: getBounds(list),
      visible: isVisible(list)
    }));
  }

  function collectDialogs() {
    return Array.from(document.querySelectorAll("dialog,[role='dialog'],[role='alertdialog']")).slice(0, 40).map((dialog) => ({
      role: getRole(dialog),
      label: getAccessibleName(dialog),
      textPreview: truncate(getElementText(dialog), 500),
      open: dialog instanceof HTMLDialogElement ? dialog.open : null,
      selector: getCssPath(dialog),
      bounds: getBounds(dialog),
      visible: isVisible(dialog)
    }));
  }

  function collectLiveRegions() {
    return Array.from(document.querySelectorAll("[aria-live],[role='alert'],[role='status']")).slice(0, 40).map((element) => ({
      role: getRole(element),
      ariaLive: getNullableAttribute(element, "aria-live"),
      text: truncate(getElementText(element), 500),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectSelectOptions(select) {
    return Array.from(select.options).slice(0, MAX_OPTIONS).map((option) => ({
      text: truncate(normalizeText(option.textContent || ""), 160),
      disabled: option.disabled
    }));
  }

  function getAccessibleName(element) {
    if (!element) return null;

    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return truncate(normalizeText(ariaLabel), MAX_TEXT_LENGTH);

    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => getElementText(node))
        .join(" ");
      if (text) return truncate(normalizeText(text), MAX_TEXT_LENGTH);
    }

    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return truncate(getElementText(label), MAX_TEXT_LENGTH);
    }

    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return truncate(getElementText(wrappingLabel), MAX_TEXT_LENGTH);

    const title = element.getAttribute("title");
    if (title) return truncate(normalizeText(title), MAX_TEXT_LENGTH);

    const alt = element.getAttribute("alt");
    if (alt) return truncate(normalizeText(alt), MAX_TEXT_LENGTH);

    return null;
  }

  function getDescribedByText(element) {
    const describedBy = element.getAttribute("aria-describedby");
    if (!describedBy) return null;

    const text = describedBy
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter(Boolean)
      .map((node) => getElementText(node))
      .join(" ");

    return text ? truncate(normalizeText(text), MAX_TEXT_LENGTH) : null;
  }

  function getElementText(element) {
    if (!element) return "";
    return normalizeText(element.innerText || element.textContent || "");
  }

  function getRole(element) {
    return element.getAttribute("role") || inferNativeRole(element);
  }

  function inferNativeRole(element) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "nav") return "navigation";
    if (tag === "main") return "main";
    if (tag === "header") return "banner";
    if (tag === "footer") return "contentinfo";
    if (tag === "aside") return "complementary";
    if (tag === "form") return "form";
    if (tag === "ul" || tag === "ol") return "list";
    if (tag === "li") return "listitem";
    if (tag === "table") return "table";
    if (tag === "input") return inferInputRole(element);
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    return null;
  }

  function inferInputRole(input) {
    const type = getInputType(input);
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "range") return "slider";
    if (type === "button" || type === "submit" || type === "reset") return "button";
    return "textbox";
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

  function getInputType(element) {
    return element.getAttribute("type") || (element.tagName.toLowerCase() === "input" ? "text" : null);
  }

  function getNameAttribute(element) {
    return element.getAttribute("name") || null;
  }

  function getNullableAttribute(element, attribute) {
    return element.hasAttribute(attribute) ? element.getAttribute(attribute) : null;
  }

  function isFormControl(element) {
    return element.matches("input, select, textarea");
  }

  function isCheckable(element) {
    const type = getInputType(element);
    return type === "checkbox" || type === "radio" || element.getAttribute("role") === "checkbox" || element.getAttribute("role") === "radio";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) !== 0 && rect.width > 0 && rect.height > 0;
  }

  function getBounds(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      top: round(rect.top),
      right: round(rect.right),
      bottom: round(rect.bottom),
      left: round(rect.left),
      inViewport: rect.bottom >= 0 && rect.right >= 0 && rect.top <= window.innerHeight && rect.left <= window.innerWidth
    };
  }

  function getCssPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.id) return `#${cssEscape(element.id)}`;

    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const classNames = Array.from(current.classList).slice(0, 2);
      if (classNames.length) {
        part += `.${classNames.map(cssEscape).join(".")}`;
      }

      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
        if (sameTagSiblings.length > 1) {
          part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
        }
      }

      parts.unshift(part);
      if (parts.length >= 5) break;
      current = parent;
    }

    return parts.join(" > ");
  }

  function getCanonicalUrl() {
    const canonical = document.querySelector("link[rel='canonical']");
    return canonical ? normalizeUrl(canonical.href) : null;
  }

  function getMeta(name) {
    const meta = document.querySelector(`meta[name='${name}'], meta[property='${name}']`);
    return meta?.getAttribute("content") || null;
  }

  function normalizeUrl(url) {
    if (!url) return null;
    try {
      return new URL(url, pageUrl).href;
    } catch {
      return url;
    }
  }

  function safeOrigin(url) {
    if (!url) return null;
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
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, maxLength - 1)}…`;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

function installGuidedTaskOverlay(plan) {
  const ROOT_ID = "bridge-guided-task-root";
  const HIGHLIGHT_ID = "bridge-guided-task-highlight";
  const STYLE_ID = "bridge-guided-task-style";
  const ACTIVE_CLASS = "bridge-guided-task-active-target";

  let currentIndex = 0;
  let currentTarget = null;
  let recoveryUsed = false;
  let riskAccepted = false;
  let urlAtStepStart = location.href;
  let mutationObserver = null;

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

  const clickListener = (event) => {
    if (currentTarget && currentTarget.contains(event.target)) maybeCompleteStep("click");
  };
  const inputListener = (event) => {
    if (currentTarget && currentTarget.contains(event.target)) maybeCompleteStep("inputChanged", event.target);
  };
  const changeListener = (event) => {
    if (currentTarget && currentTarget.contains(event.target)) maybeCompleteStep("inputChanged", event.target);
  };

  document.addEventListener("click", clickListener, true);
  document.addEventListener("input", inputListener, true);
  document.addEventListener("change", changeListener, true);
  window.addEventListener("resize", positionOverlay);
  window.addEventListener("scroll", positionOverlay, true);

  const urlTimer = window.setInterval(() => {
    if (location.href !== urlAtStepStart) maybeCompleteStep("urlChanged");
  }, 600);
  window.__bridgeGuidedTaskCleanup = endGuide;

  renderStep();

  function renderStep(message = "") {
    const step = plan.steps[currentIndex];
    if (!step) {
      renderFinished();
      return;
    }

    recoveryUsed = false;
    riskAccepted = step.risk !== "high";
    urlAtStepStart = location.href;
    currentTarget = resolveTarget(step.target);
    observeCurrentTarget();

    if (currentTarget) {
      currentTarget.classList.add(ACTIVE_CLASS);
      currentTarget.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }

    root.innerHTML = panelHtml(step, message);
    bindPanelButtons();
    window.setTimeout(positionOverlay, 250);
  }

  function panelHtml(step, message) {
    const isHighRisk = step.risk === "high" && !riskAccepted;
    const targetStatus = currentTarget ? "" : `<p class="bridge-guide-warning">Target not found. Try recovery or continue manually.</p>`;
    const riskGate = isHighRisk
      ? `<div class="bridge-guide-risk"><strong>Review before acting.</strong><span>This step may have sensitive or hard-to-undo consequences. The extension will not perform the action for you.</span></div>`
      : "";

    return `
      <section class="bridge-guide-panel">
        <div class="bridge-guide-kicker">Guided Task Mode</div>
        <h2>${escapeHtml(step.title)}</h2>
        <p class="bridge-guide-summary">${escapeHtml(plan.summary || "")}</p>
        ${riskGate}
        <p class="bridge-guide-instruction">${escapeHtml(step.instruction)}</p>
        ${targetStatus}
        ${message ? `<p class="bridge-guide-message">${escapeHtml(message)}</p>` : ""}
        <div class="bridge-guide-progress">Step ${currentIndex + 1} of ${plan.steps.length}</div>
        <div class="bridge-guide-actions">
          <button type="button" data-bridge-action="back" ${currentIndex === 0 ? "disabled" : ""}>Back</button>
          ${isHighRisk ? `<button type="button" data-bridge-action="accept-risk">Continue</button>` : `<button type="button" data-bridge-action="next">Next</button>`}
          <button type="button" data-bridge-action="recover">Retry target</button>
          <button type="button" data-bridge-action="end">End</button>
        </div>
      </section>
    `;
  }

  function bindPanelButtons() {
    for (const button of root.querySelectorAll("[data-bridge-action]")) {
      button.addEventListener("click", () => {
        const action = button.dataset.bridgeAction;
        if (action === "back") goToStep(currentIndex - 1);
        if (action === "next") goToStep(currentIndex + 1);
        if (action === "accept-risk") {
          riskAccepted = true;
          root.innerHTML = panelHtml(plan.steps[currentIndex], "Risk gate acknowledged. Complete the action on the original page when ready.");
          bindPanelButtons();
          positionOverlay();
        }
        if (action === "recover") recoverTarget();
        if (action === "end") endGuide();
      });
    }
  }

  function goToStep(nextIndex) {
    clearTarget();
    currentIndex = Math.max(0, Math.min(nextIndex, plan.steps.length));
    renderStep();
  }

  function maybeCompleteStep(eventType, eventTarget = null) {
    const step = plan.steps[currentIndex];
    if (!step || (step.risk === "high" && !riskAccepted)) return;
    const completion = step.completion || { type: "manual" };
    const type = completion.type || "manual";

    if (type === "manual") return;
    if (type === "click" && eventType === "click") return goToStep(currentIndex + 1);
    if (type === "inputChanged" && eventType === "inputChanged") return goToStep(currentIndex + 1);
    if (type === "inputValueEquals" && eventTarget && String(eventTarget.value || "").trim() === String(completion.value || "").trim()) return goToStep(currentIndex + 1);
    if (type === "checked" && eventTarget && Boolean(eventTarget.checked)) return goToStep(currentIndex + 1);
    if (type === "urlChanged" && eventType === "urlChanged") return goToStep(currentIndex + 1);
    if (type === "dialogAppears" && document.querySelector("dialog[open],[role='dialog'],[role='alertdialog']")) return goToStep(currentIndex + 1);
  }

  function recoverTarget() {
    if (recoveryUsed) {
      root.innerHTML = panelHtml(plan.steps[currentIndex], "Target recovery already ran once for this step.");
      bindPanelButtons();
      return;
    }

    recoveryUsed = true;
    clearTarget();
    currentTarget = resolveTarget(plan.steps[currentIndex].target, true);
    if (currentTarget) {
      currentTarget.classList.add(ACTIVE_CLASS);
      currentTarget.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
      observeCurrentTarget();
      root.innerHTML = panelHtml(plan.steps[currentIndex], "Target recovered.");
      bindPanelButtons();
      window.setTimeout(positionOverlay, 250);
      return;
    }

    root.innerHTML = panelHtml(plan.steps[currentIndex], "Target still not found. Continue manually or end the guide.");
    bindPanelButtons();
    positionOverlay();
  }

  function resolveTarget(target, broadSearch = false) {
    const bySelector = findBySelector(target.selector);
    if (bySelector) return bySelector;

    const candidates = Array.from(document.querySelectorAll([
      "a[href]",
      "button",
      "input",
      "select",
      "textarea",
      "summary",
      "[role]",
      "[tabindex]:not([tabindex='-1'])",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "p",
      "li",
      "label"
    ].join(","))).filter(isVisible);

    let best = null;
    let bestScore = broadSearch ? 2 : 4;
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
    const text = normalize(getElementText(element));
    const label = normalize(getAccessibleName(element));
    const role = normalize(getRole(element));
    const name = normalize(element.getAttribute("name"));
    const type = normalize(element.getAttribute("type"));
    const placeholder = normalize(element.getAttribute("placeholder"));
    const href = element instanceof HTMLAnchorElement ? element.href : "";
    let score = 0;

    if (target.role && role === normalize(target.role)) score += 3;
    if (target.label && label && includesEither(label, target.label)) score += 5;
    if (target.text && text && includesEither(text, target.text)) score += 5;
    if (target.name && name === normalize(target.name)) score += 4;
    if (target.type && type === normalize(target.type)) score += 2;
    if (target.placeholder && placeholder && includesEither(placeholder, target.placeholder)) score += 4;
    if (target.href && href && href === target.href) score += 5;
    if (target.kind && inferKind(element) === normalize(target.kind)) score += 1;

    return score;
  }

  function inferKind(element) {
    if (element.matches("input,select,textarea")) return "formfield";
    if (element.matches("a[href]")) return "link";
    if (element.matches("button,[role='button']")) return "button";
    return "";
  }

  function positionOverlay() {
    const rect = currentTarget?.getBoundingClientRect();
    if (rect && rect.width && rect.height) {
      highlight.style.display = "block";
      highlight.style.left = `${Math.max(8, rect.left - 6)}px`;
      highlight.style.top = `${Math.max(8, rect.top - 6)}px`;
      highlight.style.width = `${Math.max(24, rect.width + 12)}px`;
      highlight.style.height = `${Math.max(24, rect.height + 12)}px`;
    } else {
      highlight.style.display = "none";
    }

    const panel = root.querySelector(".bridge-guide-panel");
    if (!panel) return;
    if (!rect) {
      panel.style.left = "20px";
      panel.style.top = "20px";
      return;
    }

    const panelWidth = Math.min(360, window.innerWidth - 32);
    const left = Math.min(Math.max(16, rect.left), window.innerWidth - panelWidth - 16);
    const below = rect.bottom + 16;
    const above = rect.top - panel.offsetHeight - 16;
    panel.style.left = `${left}px`;
    panel.style.top = `${below + panel.offsetHeight < window.innerHeight ? below : Math.max(16, above)}px`;
  }

  function observeCurrentTarget() {
    mutationObserver?.disconnect();
    if (!currentTarget) return;
    mutationObserver = new MutationObserver(() => maybeCompleteStep("dialogAppears"));
    mutationObserver.observe(document.body, { childList: true, subtree: true });
  }

  function clearTarget() {
    if (currentTarget) currentTarget.classList.remove(ACTIVE_CLASS);
    currentTarget = null;
    mutationObserver?.disconnect();
    mutationObserver = null;
  }

  function renderFinished() {
    clearTarget();
    highlight.style.display = "none";
    root.innerHTML = `
      <section class="bridge-guide-panel">
        <div class="bridge-guide-kicker">Guided Task Mode</div>
        <h2>Guide complete</h2>
        <p class="bridge-guide-instruction">The guidance plan is finished. Review the original page before any final action.</p>
        <div class="bridge-guide-actions">
          <button type="button" data-bridge-action="end">Close</button>
        </div>
      </section>
    `;
    bindPanelButtons();
    positionOverlay();
  }

  function endGuide() {
    clearTarget();
    document.removeEventListener("click", clickListener, true);
    document.removeEventListener("input", inputListener, true);
    document.removeEventListener("change", changeListener, true);
    window.removeEventListener("resize", positionOverlay);
    window.removeEventListener("scroll", positionOverlay, true);
    window.clearInterval(urlTimer);
    mutationObserver?.disconnect();
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    if (window.__bridgeGuidedTaskCleanup === endGuide) {
      window.__bridgeGuidedTaskCleanup = null;
    }
  }

  function cleanupExistingGuide() {
    if (typeof window.__bridgeGuidedTaskCleanup === "function") {
      window.__bridgeGuidedTaskCleanup();
    }
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document.querySelectorAll(`.${ACTIVE_CLASS}`).forEach((element) => element.classList.remove(ACTIVE_CLASS));
  }

  function installStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      #${ROOT_ID} {
        position: fixed;
        inset: 0;
        z-index: 2147483646;
        pointer-events: none;
        font: 14px/1.4 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: #17202a;
      }
      #${HIGHLIGHT_ID} {
        position: fixed;
        z-index: 2147483645;
        pointer-events: none;
        border: 4px solid #1769aa;
        border-radius: 8px;
        box-shadow: 0 0 0 9999px rgba(23, 32, 42, 0.18), 0 0 0 8px rgba(23, 105, 170, 0.20);
        transition: left 140ms ease, top 140ms ease, width 140ms ease, height 140ms ease;
      }
      .${ACTIVE_CLASS} {
        scroll-margin: 120px;
      }
      .bridge-guide-panel {
        position: fixed;
        width: min(360px, calc(100vw - 32px));
        pointer-events: auto;
        background: #ffffff;
        border: 1px solid #d9dee7;
        border-radius: 8px;
        box-shadow: 0 12px 32px rgba(23, 32, 42, 0.28);
        padding: 14px;
      }
      .bridge-guide-kicker {
        color: #1769aa;
        font-size: 12px;
        font-weight: 800;
        text-transform: uppercase;
      }
      .bridge-guide-panel h2 {
        margin: 4px 0 8px;
        font-size: 18px;
        line-height: 1.2;
      }
      .bridge-guide-summary,
      .bridge-guide-instruction,
      .bridge-guide-warning,
      .bridge-guide-message,
      .bridge-guide-progress {
        margin: 8px 0;
      }
      .bridge-guide-summary,
      .bridge-guide-progress {
        color: #5d6978;
        font-size: 12px;
      }
      .bridge-guide-warning {
        color: #b3261e;
        font-weight: 700;
      }
      .bridge-guide-message {
        color: #0f4f82;
      }
      .bridge-guide-risk {
        display: grid;
        gap: 4px;
        margin: 10px 0;
        border: 1px solid #f1b8b4;
        border-radius: 6px;
        background: #fff4f3;
        color: #6f1711;
        padding: 10px;
      }
      .bridge-guide-actions {
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 6px;
        margin-top: 12px;
      }
      .bridge-guide-actions button {
        min-height: 34px;
        border: 1px solid #1769aa;
        border-radius: 6px;
        background: #1769aa;
        color: #ffffff;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
      }
      .bridge-guide-actions button:disabled {
        border-color: #d9dee7;
        background: #e6e9ef;
        color: #8792a1;
        cursor: not-allowed;
      }
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
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      return labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map((node) => getElementText(node))
        .join(" ");
    }
    if (element.id) {
      const label = document.querySelector(`label[for="${cssEscape(element.id)}"]`);
      if (label) return getElementText(label);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return getElementText(wrappingLabel);
    return element.getAttribute("title") || element.getAttribute("alt") || "";
  }

  function getRole(element) {
    return element.getAttribute("role") || inferNativeRole(element);
  }

  function inferNativeRole(element) {
    const tag = element.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "button") return "button";
    if (tag === "input") return "textbox";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    return "";
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
    return String(value || "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

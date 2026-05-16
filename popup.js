const extractButton = document.getElementById("extractButton");
const includeScreenshot = document.getElementById("includeScreenshot");
const statusEl = document.getElementById("status");
const outputEl = document.getElementById("output");
const copyButton = document.getElementById("copyButton");
const downloadButton = document.getElementById("downloadButton");
const pageAnalysisRequestButton = document.getElementById("pageAnalysisRequestButton");
const acceptPageAnalysisButton = document.getElementById("acceptPageAnalysisButton");
const strategyRequestButton = document.getElementById("strategyRequestButton");
const acceptStrategyButton = document.getElementById("acceptStrategyButton");
const patchPlanRequestButton = document.getElementById("patchPlanRequestButton");
const geminiRequestButton = document.getElementById("geminiRequestButton");
const applyDemoPatchButton = document.getElementById("applyDemoPatchButton");
const applyPatchButton = document.getElementById("applyPatchButton");
const resetPatchButton = document.getElementById("resetPatchButton");
const textCountEl = document.getElementById("textCount");
const interactiveCountEl = document.getElementById("interactiveCount");
const formCountEl = document.getElementById("formCount");
const imageCountEl = document.getElementById("imageCount");

let latestSnapshotJson = "";
let latestSnapshot = null;
let latestPageAnalysis = null;
let latestSimplificationStrategy = null;
let latestPatchPlan = null;
let latestOutputKind = "snapshot";
const insertedPatchCssByTab = new Map();

const NON_NEGOTIABLE_FORBIDDEN_OPERATIONS = [
  "replace_interactive_node",
  "clone_interactive_node",
  "remove_interactive_node",
  "rewrite_innerHTML",
  "change_href",
  "change_src",
  "change_value",
  "change_button_type",
  "change_form_action",
  "synthetic_click_purchase_button"
];

const DEFAULT_SUPPORTED_PATCH_PLAN_OPERATIONS = [
  {
    type: "create_shell",
    title: "short shell title",
    subtitle: "optional shell subtitle",
    slots: [
      {
        id: "primary-actions | main-content | secondary-content",
        title: "visible slot heading",
        description: "optional short helper text"
      }
    ]
  },
  {
    type: "move_node",
    selector: "CSS selector for an existing original node",
    slot: "target shell slot id",
    label: "optional short label shown above the moved node or reference"
  },
  {
    type: "reference_node",
    selector: "CSS selector for an existing original interactive node",
    slot: "target shell slot id",
    label: "short label for the shell proxy"
  },
  {
    type: "collapse_region",
    selector: "CSS selector for an existing lower-priority original region",
    title: "summary text for the collapsible section",
    slot: "optional target shell slot id"
  },
  {
    type: "add_class",
    selector: "CSS selector for existing nodes",
    className: "single CSS class name"
  },
  {
    type: "set_attribute",
    selector: "CSS selector for existing nodes",
    name: "title | aria-label | data-bridge-*",
    value: "short non-secret string"
  }
];

const DEFAULT_RESPONSE_CONTRACT = {
  returnOnly: "valid JSON without markdown fences",
  schema: {
    schemaVersion: "bridge-ui-patch-plan/0.1",
    css: "Optional CSS string for small shell refinements. Do not use @import, url(), javascript:, or external resources.",
    operations: [
      {
        type: "create_shell | move_node | reference_node | collapse_region | add_class | set_attribute",
        selector: "Only for move_node, reference_node, collapse_region, add_class, set_attribute",
        slot: "Only for move_node, reference_node, or collapse_region",
        slots: "Only for create_shell",
        title: "Only for create_shell or collapse_region",
        label: "Only for move_node or reference_node",
        className: "Only for add_class",
        name: "Only for set_attribute",
        value: "Only for set_attribute"
      }
    ],
    preservationNotes: ["Explain how original interactive nodes are preserved."],
    riskySelectors: ["Selectors that may be unstable or may affect too many nodes."]
  }
};

const GEMINI_REQUEST_INSTRUCTIONS = `Return only valid JSON. Do not use markdown fences.

Create a drastic simplification Patch Plan for this Chrome extension workflow.

Context:
This is a Korean school portal / RIRO-style page. The goal is to reduce perceived page complexity by at least 50%, not to lightly polish the current page.

Do not regenerate HTML.
Do not replace the page.
Do not replace, clone, remove, or rewrite interactive elements.
Preserve original buttons, links, inputs, selects, forms, purchase controls, and their JavaScript behavior.

Use only the supportedPatchPlanOperations from the request.
Prefer create_shell plus move_node operations over CSS-only changes.
Use reference_node for preserved interactive controls. A reference_node should behave like the simplified action for that control, not merely a list item. Use move_node only for non-interactive content that does not depend on parent event delegation.
Use collapse_region for lower-priority original regions instead of hiding important content.
Only use CSS for small shell refinements, scoped under html.bridge-simplified-school.
Do not use set_style operations.
Never hide login/account links, school visit/reservation controls, forms, important navigation, urgent notices, primary content lists, or footer policy buttons.
Use stable semantic class/id selectors when available. Avoid nth-of-type unless there is no stable alternative.
If a selector is risky or broad, include it in riskySelectors.
Use "type" for every operation; do not use "op".
The output must match the responseContract in the request.

JSON:`;

const PAGE_ANALYSIS_REQUEST_INSTRUCTIONS = `Return only valid JSON. Do not use markdown fences.

Analyze this Page Snapshot for a staged Chrome extension workflow.

Do not propose CSS.
Do not propose DOM operations.
Do not regenerate HTML.
Do not include form values, cookies, tokens, or secrets.
Use only selectors that appear in the snapshot when possible.

Identify the page type, primary user tasks, critical content, low-value regions, and Preserved Interactive Nodes.
The output must match the responseContract in the request.

JSON:`;

const SIMPLIFICATION_STRATEGY_REQUEST_INSTRUCTIONS = `Return only valid JSON. Do not use markdown fences.

Create a presentation strategy for this staged Chrome extension workflow.

Use the Page Analysis as the source of truth for critical content and Preserved Interactive Nodes.
Do not propose CSS.
Do not propose executable DOM operations.
Do not regenerate HTML.
Do not ask to hide, replace, clone, or move preserved interactive nodes.
The output must match the responseContract in the request.

JSON:`;

const STAGED_PATCH_PLAN_REQUEST_INSTRUCTIONS = `Return only valid JSON. Do not use markdown fences.

Create a drastic simplification Patch Plan for this Chrome extension workflow.

Use the Page Analysis and Simplification Strategy to guide the final selector-based patch.
Do not regenerate HTML.
Do not replace the page.
Do not replace, clone, remove, or rewrite interactive elements.
Preserve original buttons, links, inputs, selects, forms, purchase controls, and their JavaScript behavior.

Use only the supportedPatchPlanOperations from the request.
Prefer create_shell plus move_node operations over CSS-only changes.
Use reference_node for preserved interactive controls. A reference_node should behave like the simplified action for that control, not merely a list item. Use move_node only for non-interactive content that does not depend on parent event delegation.
Use collapse_region for lower-priority original regions instead of hiding important content.
Only use CSS for small shell refinements, scoped under html.bridge-simplified-school.
Do not use set_style operations.
Never hide login/account links, school visit/reservation controls, forms, important navigation, urgent notices, primary content lists, or footer policy buttons.
Use stable semantic class/id selectors when available. Avoid nth-of-type unless there is no stable alternative.
If a selector is risky or broad, include it in riskySelectors.
Use "type" for every operation; do not use "op".
The output must match the responseContract in the request.

JSON:`;

extractButton.addEventListener("click", extractCurrentPage);
copyButton.addEventListener("click", copySnapshot);
downloadButton.addEventListener("click", downloadSnapshot);
outputEl.addEventListener("input", refreshWorkflowControls);
pageAnalysisRequestButton.addEventListener("click", buildPageAnalysisRequest);
acceptPageAnalysisButton.addEventListener("click", acceptPageAnalysisFromEditor);
strategyRequestButton.addEventListener("click", buildSimplificationStrategyRequest);
acceptStrategyButton.addEventListener("click", acceptSimplificationStrategyFromEditor);
patchPlanRequestButton.addEventListener("click", buildStagedPatchPlanRequest);
geminiRequestButton.addEventListener("click", buildGeminiPatchRequest);
applyDemoPatchButton.addEventListener("click", applyDemoPatch);
applyPatchButton.addEventListener("click", applyPatchFromEditor);
resetPatchButton.addEventListener("click", resetLivePatch);
refreshWorkflowControls();

async function extractCurrentPage() {
  setBusy(true);
  setStatus("Extracting page snapshot...");

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: collectPageSnapshot
    });

    const snapshot = result;
    if (includeScreenshot.checked) {
      setStatus("Capturing visible screenshot...");
      snapshot.privacy.screenshotIncluded = true;
      snapshot.visualSnapshot = {
        kind: "visibleViewportScreenshot",
        format: "png",
        dataUrl: await chrome.tabs.captureVisibleTab(tab.windowId, { format: "png" })
      };
    }

    latestSnapshot = snapshot;
    clearWorkflowArtifacts();
    latestSnapshotJson = JSON.stringify(snapshot, null, 2);
    latestOutputKind = "snapshot";
    outputEl.value = latestSnapshotJson;
    updateSummary(snapshot);
    copyButton.disabled = false;
    downloadButton.disabled = false;
    refreshWorkflowControls();
    setStatus("Snapshot extracted.");
  } catch (error) {
    latestSnapshot = null;
    clearWorkflowArtifacts();
    latestSnapshotJson = "";
    latestOutputKind = "snapshot";
    outputEl.value = "";
    copyButton.disabled = true;
    downloadButton.disabled = true;
    refreshWorkflowControls();
    updateSummary(null);
    setStatus(error.message || "Failed to extract snapshot.", true);
  } finally {
    setBusy(false);
  }
}

async function copySnapshot() {
  const content = outputEl.value || latestSnapshotJson;
  if (!content) return;
  await navigator.clipboard.writeText(content);
  setStatus("Current editor content copied.");
}

function downloadSnapshot() {
  const content = outputEl.value || latestSnapshotJson;
  if (!content) return;

  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${downloadPrefix()}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus("Current editor content downloaded.");
}

function downloadPrefix() {
  if (latestOutputKind === "pageAnalysisRequest") return "bridge-page-analysis-request";
  if (latestOutputKind === "pageAnalysis") return "bridge-page-analysis";
  if (latestOutputKind === "simplificationStrategyRequest") return "bridge-simplification-strategy-request";
  if (latestOutputKind === "simplificationStrategy") return "bridge-simplification-strategy";
  if (latestOutputKind === "patchPlanRequest") return "bridge-ui-patch-plan-request";
  if (latestOutputKind === "legacyGeminiRequest") return "gemini-ui-patch-request";
  if (latestOutputKind === "patchPlan") return "bridge-ui-patch-plan";
  return "page-snapshot";
}

function setBusy(isBusy) {
  extractButton.disabled = isBusy;
  extractButton.textContent = isBusy ? "Extracting..." : "Extract current page";
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

function clearWorkflowArtifacts() {
  latestPageAnalysis = null;
  latestSimplificationStrategy = null;
  latestPatchPlan = null;
}

function refreshWorkflowControls() {
  const hasSnapshot = Boolean(latestSnapshot);
  const hasEditorText = Boolean(outputEl.value.trim());
  pageAnalysisRequestButton.disabled = !hasSnapshot;
  acceptPageAnalysisButton.disabled = !hasSnapshot || !hasEditorText;
  strategyRequestButton.disabled = !latestPageAnalysis;
  acceptStrategyButton.disabled = !latestPageAnalysis || !hasEditorText;
  patchPlanRequestButton.disabled = !latestPageAnalysis || !latestSimplificationStrategy;
  geminiRequestButton.disabled = !hasSnapshot;
}

function buildPageAnalysisRequest() {
  if (!latestSnapshot) {
    setStatus("Extract a page snapshot before building a Page Analysis request.", true);
    return;
  }

  const request = createPageAnalysisRequest(latestSnapshot);
  latestSnapshotJson = buildCopyPastePrompt(PAGE_ANALYSIS_REQUEST_INSTRUCTIONS, request);
  latestOutputKind = "pageAnalysisRequest";
  outputEl.value = latestSnapshotJson;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  refreshWorkflowControls();
  setStatus("Page Analysis request built. Paste Gemini's Page Analysis JSON here, then accept it.");
}

function acceptPageAnalysisFromEditor() {
  try {
    const analysis = normalizePageAnalysis(parseJsonFromEditor(outputEl.value, "Page Analysis"));
    latestPageAnalysis = analysis;
    latestSimplificationStrategy = null;
    latestPatchPlan = null;
    latestSnapshotJson = JSON.stringify(analysis, null, 2);
    latestOutputKind = "pageAnalysis";
    outputEl.value = latestSnapshotJson;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    refreshWorkflowControls();
    setStatus("Page Analysis accepted. Build the Simplification Strategy request next.");
  } catch (error) {
    setStatus(error.message || "Page Analysis could not be accepted.", true);
  }
}

function buildSimplificationStrategyRequest() {
  if (!latestSnapshot) {
    setStatus("Extract a page snapshot before building a Simplification Strategy request.", true);
    return;
  }
  if (!latestPageAnalysis) {
    setStatus("Accept Page Analysis before building a Simplification Strategy request.", true);
    return;
  }

  const request = createSimplificationStrategyRequest(latestSnapshot, latestPageAnalysis);
  latestSnapshotJson = buildCopyPastePrompt(SIMPLIFICATION_STRATEGY_REQUEST_INSTRUCTIONS, request);
  latestOutputKind = "simplificationStrategyRequest";
  outputEl.value = latestSnapshotJson;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  refreshWorkflowControls();
  setStatus("Simplification Strategy request built. Paste Gemini's Strategy JSON here, then accept it.");
}

function acceptSimplificationStrategyFromEditor() {
  try {
    const strategy = normalizeSimplificationStrategy(parseJsonFromEditor(outputEl.value, "Simplification Strategy"));
    latestSimplificationStrategy = strategy;
    latestPatchPlan = null;
    latestSnapshotJson = JSON.stringify(strategy, null, 2);
    latestOutputKind = "simplificationStrategy";
    outputEl.value = latestSnapshotJson;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    refreshWorkflowControls();
    setStatus("Simplification Strategy accepted. Build the Patch Plan request next.");
  } catch (error) {
    setStatus(error.message || "Simplification Strategy could not be accepted.", true);
  }
}

function buildStagedPatchPlanRequest() {
  if (!latestSnapshot) {
    setStatus("Extract a page snapshot before building a Patch Plan request.", true);
    return;
  }
  if (!latestPageAnalysis || !latestSimplificationStrategy) {
    setStatus("Accept Page Analysis and Simplification Strategy before building a Patch Plan request.", true);
    return;
  }

  const request = createStagedPatchPlanRequest(latestSnapshot, latestPageAnalysis, latestSimplificationStrategy);
  latestSnapshotJson = buildCopyPastePrompt(STAGED_PATCH_PLAN_REQUEST_INSTRUCTIONS, request);
  latestOutputKind = "patchPlanRequest";
  outputEl.value = latestSnapshotJson;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  refreshWorkflowControls();
  setStatus("Patch Plan request built. Paste Gemini's Patch Plan JSON here, then apply it.");
}

function buildGeminiPatchRequest() {
  if (!latestSnapshot) {
    setStatus("Extract a page snapshot before building a legacy one-shot request.", true);
    return;
  }

  const request = createGeminiPatchRequest(latestSnapshot);
  latestSnapshotJson = buildCopyPastePrompt(GEMINI_REQUEST_INSTRUCTIONS, request);
  latestOutputKind = "legacyGeminiRequest";
  outputEl.value = latestSnapshotJson;
  copyButton.disabled = false;
  downloadButton.disabled = false;
  refreshWorkflowControls();
  setStatus("Legacy one-shot request built. Paste Gemini's Patch Plan JSON here, then apply it.");
}

async function applyDemoPatch() {
  try {
    const plan = createDemoPatchPlan();
    await applyPatchPlanToActiveTab(plan);
    latestSnapshotJson = JSON.stringify(plan, null, 2);
    latestOutputKind = "patchPlan";
    latestPatchPlan = plan;
    outputEl.value = latestSnapshotJson;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    refreshWorkflowControls();
  } catch (error) {
    setStatus(error.message || "Demo patch could not be applied.", true);
  }
}

async function applyPatchFromEditor() {
  try {
    const plan = normalizePatchPlan(parseJsonFromEditor(outputEl.value, "Patch Plan"));
    await applyPatchPlanToActiveTab(plan);
    latestSnapshotJson = JSON.stringify(plan, null, 2);
    latestOutputKind = "patchPlan";
    latestPatchPlan = plan;
    outputEl.value = latestSnapshotJson;
    copyButton.disabled = false;
    downloadButton.disabled = false;
    refreshWorkflowControls();
  } catch (error) {
    setStatus(error.message || "Patch plan could not be applied.", true);
  }
}

async function resetLivePatch() {
  try {
    const tab = await getActiveTab();
    await removeInsertedPatchCss(tab.id);
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: resetPatchInPage
    });
    setStatus(`Patch reset. Restored ${result?.restored || 0} modified node(s).`);
  } catch (error) {
    setStatus(error.message || "Patch could not be reset.", true);
  }
}

async function applyPatchPlanToActiveTab(plan) {
  const tab = await getActiveTab();
  setStatus("Applying live UI patch...");

  await removeInsertedPatchCss(tab.id);
  const extensionCss = buildExtensionInjectedCss(plan);
  if (extensionCss) {
    await chrome.scripting.insertCSS({
      target: { tabId: tab.id },
      css: extensionCss,
      origin: "USER"
    });
    insertedPatchCssByTab.set(tab.id, extensionCss);
  }

  const domPlan = {
    ...plan,
    css: "",
    operations: Array.isArray(plan.operations)
      ? plan.operations.filter((operation) => operation?.type !== "set_style")
      : []
  };

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: applyPatchPlanInPage,
    args: [domPlan]
  });

  if (!result) {
    throw new Error("No patch result returned from the page.");
  }

  const skippedCount = result.skipped?.length || 0;
  const skipped = skippedCount ? ` Skipped ${skippedCount} item(s): ${result.skipped[0]}` : "";
  const cssCount = extensionCss ? 1 : 0;
  setStatus(`Patch applied: ${(result.applied || 0) + cssCount} change(s).${skipped}`);
}

async function removeInsertedPatchCss(tabId) {
  const previousCss = insertedPatchCssByTab.get(tabId);
  if (!previousCss) return;

  try {
    await chrome.scripting.removeCSS({
      target: { tabId },
      css: previousCss,
      origin: "USER"
    });
  } finally {
    insertedPatchCssByTab.delete(tabId);
  }
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {
    throw new Error("No active tab found.");
  }
  return tab;
}

function buildExtensionInjectedCss(plan) {
  if (!plan || typeof plan !== "object") return "";
  const operations = Array.isArray(plan.operations) ? plan.operations.slice(0, 120) : [];
  const chunks = [];

  if (typeof plan.css === "string" && plan.css.trim() && !isUnsafePatchCss(plan.css)) {
    chunks.push(buildStablePatchCss(plan.css, operations));
  }

  const operationCss = buildSetStylePatchCss(operations);
  if (operationCss) chunks.push(operationCss);
  return chunks.join("\n\n").trim();
}

function buildStablePatchCss(css, operations) {
  let stableCss = String(css);
  for (const operation of operations) {
    if (operation?.type !== "add_class") continue;
    const selector = String(operation.selector || "").trim();
    const className = String(operation.className || "").trim();
    if (!selector.startsWith("body") || !className) continue;

    const bodyScope = selector.includes(`.${className}`) ? selector : `${selector}.${className}`;
    const htmlScope = `html.${className} ${selector}`;
    stableCss = stableCss.split(bodyScope).join(htmlScope);
  }
  return addImportantToPatchCss(stableCss);
}

function addImportantToPatchCss(css) {
  return String(css).replace(/\{([^{}]*)\}/g, (block, body) => {
    const declarations = body
      .split(";")
      .map((declaration) => declaration.trim())
      .filter(Boolean)
      .map((declaration) => {
        const colonIndex = declaration.indexOf(":");
        if (colonIndex <= 0) return declaration;
        const property = declaration.slice(0, colonIndex).trim();
        const value = declaration.slice(colonIndex + 1).trim();
        if (!property || property.startsWith("--") || /!important\s*$/i.test(value)) {
          return `${property}: ${value}`;
        }
        return `${property}: ${value} !important`;
      });
    return declarations.length ? `{ ${declarations.join("; ")}; }` : block;
  });
}

function buildSetStylePatchCss(operations) {
  const rules = [];
  for (const operation of operations) {
    if (operation?.type !== "set_style") continue;
    const selector = String(operation.selector || "").trim();
    if (!selector || selector.length > 240 || !canParsePatchSelector(selector)) continue;

    const styles = operation.styles && typeof operation.styles === "object" && !Array.isArray(operation.styles)
      ? Object.entries(operation.styles).slice(0, 30)
      : [];
    const declarations = [];
    for (const [property, value] of styles) {
      const propertyName = toPatchKebabCase(property);
      const propertyValue = String(value);
      if (!isSafePatchCssProperty(propertyName) || isUnsafePatchCss(propertyValue) || propertyValue.length > 220) continue;
      declarations.push(`${propertyName}: ${withPatchImportant(propertyValue)};`);
    }
    if (declarations.length) {
      rules.push(`${selector} { ${declarations.join(" ")} }`);
    }
  }
  return rules.join("\n");
}

function canParsePatchSelector(selector) {
  try {
    document.querySelector(selector);
    return true;
  } catch {
    return false;
  }
}

function isUnsafePatchCss(value) {
  return /@import|url\s*\(|javascript:|expression\s*\(/i.test(String(value));
}

function isSafePatchCssProperty(property) {
  return /^[a-z-]{1,60}$/.test(property) && !["behavior", "-moz-binding"].includes(property);
}

function toPatchKebabCase(property) {
  return String(property).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`).toLowerCase();
}

function withPatchImportant(value) {
  return /!important\s*$/i.test(value) ? value : `${value} !important`;
}

function createGeminiPatchRequest(snapshot) {
  const settings = createDefaultRequestSettings(snapshot);

  return {
    schemaVersion: "bridge-gemini-ui-patch-request/0.1",
    settingsSource: "extension_predefined_settings",
    page: pick(snapshot.page, ["url", "origin", "title", "language", "direction", "canonicalUrl", "metaDescription"]),
    viewport: pick(snapshot.viewport, ["width", "height", "devicePixelRatio", "scrollX", "scrollY", "documentWidth", "documentHeight"]),
    visualSnapshot: snapshot.visualSnapshot
      ? {
          includedInSourceSnapshot: true,
          format: snapshot.visualSnapshot.format,
          dataUrlOmittedFromRequest: true,
          instruction: "Use the screenshot as a separate visual reference if the model UI supports image input."
        }
      : {
          includedInSourceSnapshot: false
        },
    snapshotExcerpt: createSnapshotExcerpt(snapshot),
    task: settings.task,
    designGoal: settings.designGoal,
    preservationPolicy: settings.preservationPolicy,
    supportedPatchPlanOperations: settings.supportedPatchPlanOperations,
    responseContract: settings.responseContract,
    qaChecklist: settings.qaChecklist
  };
}

function createPageAnalysisRequest(snapshot) {
  return {
    schemaVersion: "bridge-page-analysis-request/0.1",
    settingsSource: "extension_predefined_settings",
    page: pick(snapshot.page, ["url", "origin", "title", "language", "direction", "canonicalUrl", "metaDescription"]),
    viewport: pick(snapshot.viewport, ["width", "height", "devicePixelRatio", "scrollX", "scrollY", "documentWidth", "documentHeight"]),
    visualSnapshot: describeVisualSnapshot(snapshot),
    snapshotExcerpt: createSnapshotExcerpt(snapshot),
    privacyRules: createPrivacyRules(),
    task: "Analyze this Page Snapshot for a staged AI Patch Workflow. Identify page type, primary user tasks, critical content, low-value regions, and preserved interactive nodes. Do not propose CSS or executable patch operations.",
    responseContract: {
      returnOnly: "valid JSON without markdown fences",
      schema: {
        schemaVersion: "bridge-page-analysis/0.1",
        pageType: "short stable page type, such as product_detail_page or school_portal_home",
        primaryUserTasks: ["short user task"],
        criticalContent: [
          {
            selector: "selector from the snapshot",
            reason: "why this content is critical"
          }
        ],
        preservedInteractiveNodes: [
          {
            selector: "selector from the snapshot",
            reason: "why this original interactive node must remain behavior source"
          }
        ],
        lowValueRegions: [
          {
            selector: "selector from the snapshot",
            reason: "why this region can be visually de-emphasized"
          }
        ],
        riskNotes: ["specific risks that the final patch should avoid"]
      }
    }
  };
}

function createSimplificationStrategyRequest(snapshot, pageAnalysis) {
  return {
    schemaVersion: "bridge-simplification-strategy-request/0.1",
    settingsSource: "extension_predefined_settings",
    page: pick(snapshot.page, ["url", "origin", "title", "language", "direction", "canonicalUrl", "metaDescription"]),
    viewport: pick(snapshot.viewport, ["width", "height", "devicePixelRatio", "scrollX", "scrollY", "documentWidth", "documentHeight"]),
    snapshotSummary: createSnapshotSummary(snapshot),
    pageAnalysis,
    privacyRules: createPrivacyRules(),
    preservationPolicy: {
      preserveAllInteractiveNodes: true,
      preservedInteractiveSelectors: getPreservedInteractiveSelectors(snapshot),
      analysisPreservedInteractiveNodes: pageAnalysis.preservedInteractiveNodes || [],
      forbiddenOperations: NON_NEGOTIABLE_FORBIDDEN_OPERATIONS
    },
    task: "Create a non-executable Simplification Strategy. It should guide the final Patch Plan without changing the page directly.",
    responseContract: {
      returnOnly: "valid JSON without markdown fences",
      schema: {
        schemaVersion: "bridge-simplification-strategy/0.1",
        designGoal: "one sentence presentation outcome",
        priorities: ["presentation priority"],
        emphasize: ["selector to make more prominent"],
        deemphasize: ["selector to visually reduce without breaking behavior"],
        doNotChange: ["selector that must not be moved, hidden, cloned, or replaced"],
        layoutDirectives: ["non-executable layout direction for the final Patch Plan"],
        riskNotes: ["specific risks the Patch Plan should avoid"]
      }
    }
  };
}

function createStagedPatchPlanRequest(snapshot, pageAnalysis, simplificationStrategy) {
  const settings = createDefaultRequestSettings(snapshot);

  return {
    schemaVersion: "bridge-staged-ui-patch-request/0.1",
    settingsSource: "extension_predefined_settings",
    page: pick(snapshot.page, ["url", "origin", "title", "language", "direction", "canonicalUrl", "metaDescription"]),
    snapshotSummary: createSnapshotSummary(snapshot),
    pageAnalysis,
    simplificationStrategy,
    selectorContext: createPatchPlanSelectorContext(snapshot, pageAnalysis, simplificationStrategy),
    task: settings.task,
    designGoal: simplificationStrategy.designGoal || settings.designGoal,
    patchPlanStrategy: settings.patchPlanStrategy,
    preservationPolicy: {
      preserveAllInteractiveNodes: true,
      analysisPreservedInteractiveNodes: pageAnalysis.preservedInteractiveNodes || [],
      strategyDoNotChange: simplificationStrategy.doNotChange || [],
      forbiddenOperations: NON_NEGOTIABLE_FORBIDDEN_OPERATIONS
    },
    supportedPatchPlanOperations: settings.supportedPatchPlanOperations,
    responseContract: settings.responseContract,
    qaChecklist: [
      "Return create_shell plus reference_node operations for preserved interactive controls.",
      "Each reference_node should become a usable simplified action, not just a Show original link.",
      "Use move_node only for non-interactive critical content.",
      "Use collapse_region for lower-priority original regions.",
      "Do not recreate controls, links, inputs, forms, or their behavior.",
      "Use only selectors from selectorContext or the accepted artifacts.",
      "Keep optional CSS small and scoped under html.bridge-simplified-school."
    ]
  };
}

function createPatchPlanSelectorContext(snapshot, pageAnalysis, simplificationStrategy) {
  const selectors = uniqueStrings([
    ...selectorsFromReasonItems(pageAnalysis.criticalContent),
    ...selectorsFromReasonItems(pageAnalysis.preservedInteractiveNodes),
    ...selectorsFromReasonItems(pageAnalysis.lowValueRegions),
    ...(simplificationStrategy.emphasize || []),
    ...(simplificationStrategy.deemphasize || []),
    ...(simplificationStrategy.doNotChange || [])
  ]).slice(0, 80);

  return selectors.map((selector) => ({
    selector,
    ...summarizeSelectorForPatch(snapshot, selector),
    roles: selectorRoles(selector, pageAnalysis, simplificationStrategy)
  }));
}

function selectorsFromReasonItems(items) {
  return (items || []).map((item) => item?.selector).filter(Boolean);
}

function summarizeSelectorForPatch(snapshot, selector) {
  const content = snapshot.content || {};
  const candidates = [
    ...(content.interactiveElements || []),
    ...(content.links || []),
    ...(content.forms || []),
    ...(content.textBlocks || []),
    ...(content.headings || []),
    ...(content.landmarks || []),
    ...(content.images || []),
    ...(content.lists || [])
  ];
  const match = candidates.find((item) => item?.selector === selector);
  if (!match) return {};

  return pick(match, [
    "snapshotId",
    "tag",
    "role",
    "type",
    "label",
    "text",
    "href",
    "visible",
    "importance",
    "level",
    "alt",
    "itemCount"
  ]);
}

function selectorRoles(selector, pageAnalysis, simplificationStrategy) {
  const roles = [];
  if (selectorsFromReasonItems(pageAnalysis.criticalContent).includes(selector)) roles.push("criticalContent");
  if (selectorsFromReasonItems(pageAnalysis.preservedInteractiveNodes).includes(selector)) roles.push("preservedInteractiveNode");
  if (selectorsFromReasonItems(pageAnalysis.lowValueRegions).includes(selector)) roles.push("lowValueRegion");
  if ((simplificationStrategy.emphasize || []).includes(selector)) roles.push("emphasize");
  if ((simplificationStrategy.deemphasize || []).includes(selector)) roles.push("deemphasize");
  if ((simplificationStrategy.doNotChange || []).includes(selector)) roles.push("doNotChange");
  return roles;
}

function createDefaultRequestSettings(snapshot) {
  const preservedInteractiveSelectors = getPreservedInteractiveSelectors(snapshot);

  return {
    schemaVersion: "bridge-ai-request-settings/0.1",
    task: "Create a behavior-preserving simplified shell for this Korean school portal / RIRO-style page.",
    designGoal: "Reduce perceived page complexity by moving the few original high-value controls and content regions into a calm task-first Simplified Shell while keeping those nodes as the original behavior source.",
    patchPlanStrategy: {
      preferredShape: "create_shell, then reference_node preserved interactive controls as usable shell actions, move_node non-interactive critical content, then collapse lower-priority regions",
      avoid: "CSS-only redesigns, display:none-only patches, moved interactive controls, cloned controls, replacement HTML, broad page rewrites",
      operationFieldName: "type"
    },
    preservationPolicy: {
      preserveAllInteractiveNodes: true,
      preservedInteractiveSelectors,
      forbiddenOperations: NON_NEGOTIABLE_FORBIDDEN_OPERATIONS
    },
    supportedPatchPlanOperations: DEFAULT_SUPPORTED_PATCH_PLAN_OPERATIONS,
    responseContract: DEFAULT_RESPONSE_CONTRACT,
    qaChecklist: [
      "The page receives bridge-simplified-school on html, either explicitly or through create_shell.",
      "A create_shell operation creates the visible simplified surface.",
      "Preserved interactive nodes are proxied from the shell and remain in their original DOM context.",
      "Non-interactive critical content may be moved into shell slots with move_node.",
      "Lower-priority original regions are collapsed or moved rather than destroyed.",
      "Every optional CSS rule is scoped under html.bridge-simplified-school.",
      "Original login/account, school visit/reservation, form, navigation, notice, and footer policy nodes are not replaced or hidden.",
      "The patch avoids set_style operations.",
      "Selectors are stable enough to survive rerenders and avoid nth-of-type unless needed.",
      "CSS does not import external resources."
    ]
  };
}

function describeVisualSnapshot(snapshot) {
  return snapshot.visualSnapshot
    ? {
        includedInSourceSnapshot: true,
        format: snapshot.visualSnapshot.format,
        dataUrlOmittedFromRequest: true,
        instruction: "Use the screenshot as a separate visual reference if the model UI supports image input."
      }
    : {
        includedInSourceSnapshot: false
      };
}

function createPrivacyRules() {
  return [
    "Do not include cookies.",
    "Do not include session tokens.",
    "Do not include CSRF tokens.",
    "Do not include personal account information.",
    "Do not include full raw scripts.",
    "Do not include user-entered form values."
  ];
}

function createSnapshotSummary(snapshot) {
  const content = snapshot.content || {};
  return {
    landmarks: content.landmarks?.length || 0,
    headings: content.headings?.length || 0,
    textBlocks: content.textBlocks?.length || 0,
    interactiveElements: content.interactiveElements?.length || 0,
    forms: content.forms?.length || 0,
    links: content.links?.length || 0,
    images: content.images?.length || 0,
    tables: content.tables?.length || 0,
    dialogs: content.dialogs?.length || 0
  };
}

function createSnapshotExcerpt(snapshot) {
  const content = snapshot.content || {};
  const interactiveElements = (content.interactiveElements || []).filter((item) => item.selector);

  return {
    landmarks: (content.landmarks || []).map((item) => summarizeElement(item, ["textPreview"])),
    headings: (content.headings || []).map((item) => summarizeElement(item, ["level", "text"])),
    textBlocks: (content.textBlocks || []).map((item) => summarizeElement(item, ["text", "importance"])),
    interactiveElements: interactiveElements.map((item) => summarizeElement(item, ["snapshotId", "type", "label", "text", "href", "disabled", "required", "expanded", "hasPopup", "controls"])),
    forms: (content.forms || []).map((form) => ({
      snapshotId: form.snapshotId,
      label: form.label,
      selector: form.selector,
      method: form.method,
      actionOrigin: form.actionOrigin,
      visible: form.visible,
      fields: (form.fields || []).map((field) => summarizeElement(field, ["snapshotId", "type", "name", "label", "placeholder", "required", "disabled", "readonly", "options"]))
    })),
    images: (content.images || []).map((item) => summarizeElement(item, ["alt", "title", "src", "displayedWidth", "displayedHeight"]))
  };
}

function getPreservedInteractiveSelectors(snapshot) {
  const content = snapshot.content || {};
  const interactiveSelectors = (content.interactiveElements || [])
    .map((item) => item.selector)
    .filter(Boolean);
  const formFieldSelectors = (content.forms || [])
    .flatMap((form) => form.fields || [])
    .map((field) => field.selector)
    .filter(Boolean);
  return uniqueStrings([...interactiveSelectors, ...formFieldSelectors]);
}

function createDemoPatchPlan() {
  return {
    schemaVersion: "bridge-ui-patch-plan/0.1",
    description: "Generic CSS-first prototype that restyles original controls in place.",
    css: `
html.bridge-live-ui-patch {
  --bridge-focus: #0f766e;
  --bridge-soft-bg: #f8fafc;
}

html.bridge-live-ui-patch body {
  background-color: var(--bridge-soft-bg) !important;
}

html.bridge-live-ui-patch :is(button, [role="button"], input[type="button"], input[type="submit"]) {
  min-height: 44px !important;
  border-radius: 8px !important;
  font-weight: 700 !important;
  letter-spacing: 0 !important;
}

html.bridge-live-ui-patch :is(a, button, input, select, textarea, [role="button"], [tabindex]:not([tabindex="-1"])):focus-visible {
  outline: 3px solid var(--bridge-focus) !important;
  outline-offset: 3px !important;
}

html.bridge-live-ui-patch :is(input, select, textarea) {
  min-height: 40px !important;
  border-radius: 6px !important;
}

html.bridge-live-ui-patch img {
  border-radius: 6px !important;
}

#bridge-live-patch-badge {
  position: fixed !important;
  right: 16px !important;
  bottom: 16px !important;
  z-index: 2147483647 !important;
  padding: 8px 10px !important;
  border: 1px solid rgba(15, 118, 110, 0.35) !important;
  border-radius: 8px !important;
  background: rgba(240, 253, 250, 0.96) !important;
  color: #134e4a !important;
  font: 12px/1.2 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  box-shadow: 0 10px 24px rgba(15, 23, 42, 0.16) !important;
  pointer-events: none !important;
}
`.trim(),
    operations: [
      {
        type: "add_class",
        selector: "html",
        className: "bridge-live-ui-patch"
      },
      {
        type: "set_attribute",
        selector: "html",
        name: "data-bridge-ui-patch",
        value: "active"
      },
      {
        type: "insert_static_badge",
        text: "Bridge UI patch active"
      }
    ],
    preservationNotes: [
      "The prototype styles original DOM nodes in place.",
      "It does not replace, clone, remove, or synthesize clicks for interactive controls."
    ],
    riskySelectors: []
  };
}

function parseJsonFromEditor(raw, artifactName = "JSON artifact") {
  const text = String(raw || "").trim();
  if (!text) throw new Error(`Paste a ${artifactName} JSON object into the editor first.`);
  const jsonText = extractJsonText(text);
  const withoutFence = jsonText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(withoutFence);
  } catch (error) {
    const normalized = normalizeJsonPaste(withoutFence);
    if (normalized !== withoutFence) {
      try {
        return JSON.parse(normalized);
      } catch {
        // Preserve the original parse error; it points at the user's pasted input.
      }
    }
    throw new Error(`${artifactName} JSON could not be parsed: ${error.message}`);
  }
}

function normalizeJsonPaste(text) {
  return String(text || "")
    .replace(/[\u201c\u201d\u2033]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\u00a0/g, " ")
    .replace(/\u3000/g, " ")
    .replace(/\uff1a/g, ":")
    .replace(/\uff0c/g, ",");
}

function buildCopyPastePrompt(instructions, payload) {
  return `${instructions}\n${JSON.stringify(payload, null, 2)}`;
}

function extractJsonText(text) {
  const trimmed = String(text || "").trim();
  const jsonLabelIndex = trimmed.indexOf("JSON:");
  const afterLabel = jsonLabelIndex >= 0 ? trimmed.slice(jsonLabelIndex + "JSON:".length).trim() : trimmed;
  const firstBrace = afterLabel.indexOf("{");
  const lastBrace = afterLabel.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace < firstBrace) return afterLabel;
  return afterLabel.slice(firstBrace, lastBrace + 1);
}

function normalizePageAnalysis(candidate) {
  const analysis = candidate?.pageAnalysis || candidate;
  assertPlainArtifact(analysis, "Page Analysis");
  rejectRequestPayload(analysis, "Page Analysis");

  if (analysis.schemaVersion !== "bridge-page-analysis/0.1") {
    throw new Error("Page Analysis must use schemaVersion bridge-page-analysis/0.1.");
  }

  const normalized = {
    schemaVersion: analysis.schemaVersion,
    pageType: typeof analysis.pageType === "string" ? analysis.pageType.trim() : "",
    primaryUserTasks: requireStringArray(analysis.primaryUserTasks, "primaryUserTasks"),
    criticalContent: requireSelectorReasonArray(analysis.criticalContent, "criticalContent"),
    preservedInteractiveNodes: requireSelectorReasonArray(analysis.preservedInteractiveNodes, "preservedInteractiveNodes"),
    lowValueRegions: requireSelectorReasonArray(analysis.lowValueRegions, "lowValueRegions"),
    riskNotes: requireStringArray(analysis.riskNotes, "riskNotes")
  };

  if (!normalized.pageType) {
    throw new Error("Page Analysis must include a non-empty pageType.");
  }

  return normalized;
}

function normalizeSimplificationStrategy(candidate) {
  const strategy = candidate?.simplificationStrategy || candidate;
  assertPlainArtifact(strategy, "Simplification Strategy");
  rejectRequestPayload(strategy, "Simplification Strategy");

  if (strategy.schemaVersion !== "bridge-simplification-strategy/0.1") {
    throw new Error("Simplification Strategy must use schemaVersion bridge-simplification-strategy/0.1.");
  }

  const normalized = {
    schemaVersion: strategy.schemaVersion,
    designGoal: typeof strategy.designGoal === "string" ? strategy.designGoal.trim() : "",
    priorities: requireStringArray(strategy.priorities, "priorities"),
    emphasize: requireSelectorStringArray(strategy.emphasize, "emphasize"),
    deemphasize: requireSelectorStringArray(strategy.deemphasize, "deemphasize"),
    doNotChange: requireSelectorStringArray(strategy.doNotChange, "doNotChange"),
    layoutDirectives: requireStringArray(strategy.layoutDirectives, "layoutDirectives"),
    riskNotes: requireStringArray(strategy.riskNotes, "riskNotes")
  };

  if (!normalized.designGoal) {
    throw new Error("Simplification Strategy must include a non-empty designGoal.");
  }

  return normalized;
}

function normalizePatchPlan(candidate) {
  const plan = candidate?.patchPlan || candidate;
  assertPlainArtifact(plan, "Patch Plan");
  rejectRequestPayload(plan, "Patch Plan");

  if (plan.schemaVersion === "bridge-page-analysis/0.1") {
    throw new Error("This is Page Analysis JSON. Accept it before building a Patch Plan request.");
  }
  if (plan.schemaVersion === "bridge-simplification-strategy/0.1") {
    throw new Error("This is Simplification Strategy JSON. Accept it before building a Patch Plan request.");
  }

  const normalized = {
    schemaVersion: plan.schemaVersion || "bridge-ui-patch-plan/0.1",
    css: typeof plan.css === "string" ? plan.css : "",
    operations: normalizePatchOperations(plan.operations),
    preservationNotes: Array.isArray(plan.preservationNotes) ? plan.preservationNotes : [],
    riskySelectors: Array.isArray(plan.riskySelectors) ? plan.riskySelectors : []
  };

  if (!normalized.css && !normalized.operations.length) {
    throw new Error("Patch Plan must include css or operations.");
  }

  return normalized;
}

function normalizePatchOperations(operations) {
  if (!Array.isArray(operations)) return [];
  return operations
    .filter((operation) => operation && typeof operation === "object" && !Array.isArray(operation))
    .map((operation) => {
      const type = String(operation.type || operation.op || "").trim();
      return {
        ...operation,
        type
      };
    });
}

function assertPlainArtifact(value, artifactName) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${artifactName} must be a JSON object.`);
  }
}

function rejectRequestPayload(value, artifactName) {
  if (value.responseContract || value.supportedPatchPlanOperations || /request/i.test(String(value.schemaVersion || ""))) {
    throw new Error(`This looks like a request payload, not ${artifactName} output.`);
  }
}

function requireStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function requireSelectorStringArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }
  return value.map((item, index) => {
    const selector = String(item || "").trim();
    if (!selector) {
      throw new Error(`${fieldName}[${index}] must be a non-empty selector string.`);
    }
    return selector;
  });
}

function requireSelectorReasonArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array.`);
  }

  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${fieldName}[${index}] must be an object.`);
    }
    const selector = String(item.selector || "").trim();
    if (!selector) {
      throw new Error(`${fieldName}[${index}] must include a non-empty selector.`);
    }
    return {
      selector,
      reason: String(item.reason || "").trim()
    };
  });
}

function summarizeElement(item, extraKeys = []) {
  const base = pick(item, ["selector", "tag", "role", "bounds", "visible"]);
  for (const key of extraKeys) {
    if (item?.[key] !== undefined && item?.[key] !== null && item?.[key] !== "") {
      base[key] = item[key];
    }
  }
  return base;
}

function pick(source, keys) {
  const result = {};
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null && source?.[key] !== "") {
      result[key] = source[key];
    }
  }
  return result;
}

function uniqueStrings(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function applyPatchPlanInPage(plan, fromObserver = false) {
  const STYLE_ID = "bridge-live-ui-patch-style";
  const BADGE_ID = "bridge-live-patch-badge";
  const SHELL_ID = "bridge-simplified-shell";
  const SHELL_CLASS = "bridge-simplified-school";
  const MOVED_NODE_ATTR = "data-bridge-moved-node";
  const PLACEHOLDER_ATTR = "data-bridge-node-placeholder";
  const MISSING = "__BRIDGE_MISSING__";
  const MAX_OPERATIONS = 120;
  const MAX_TARGETS_PER_OPERATION = 100;
  let movedNodeCounter = 0;
  const result = {
    applied: 0,
    skipped: []
  };

  if (!plan || typeof plan !== "object") {
    return { applied: 0, skipped: ["Patch plan is not an object."] };
  }

  const operations = Array.isArray(plan.operations) ? plan.operations.slice(0, MAX_OPERATIONS) : [];
  const usesShell = operations.some((operation) => ["create_shell", "move_node", "reference_node", "collapse_region"].includes(operation?.type));
  if (usesShell) {
    document.documentElement.classList.add(SHELL_CLASS);
    trackClass(document.documentElement, SHELL_CLASS);
  }

  const styleText = buildInjectedCss(plan.css, operations);
  if (styleText) {
    let style = document.getElementById(STYLE_ID);
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      style.setAttribute("data-bridge-added", "true");
      document.head.append(style);
    }
    style.textContent = styleText;
    result.applied += 1;
  }

  for (const operation of operations) {
    if (!operation || typeof operation !== "object") {
      result.skipped.push("Skipped invalid operation.");
      continue;
    }

    if (operation.type === "create_shell") {
      ensureShell(operation);
      result.applied += 1;
      continue;
    }

    if (operation.type === "move_node") {
      moveNodesToSlot(operation);
      continue;
    }

    if (operation.type === "reference_node") {
      referenceNodesInSlot(operation);
      continue;
    }

    if (operation.type === "collapse_region") {
      collapseRegionsIntoSlot(operation);
      continue;
    }

    if (operation.type === "insert_static_badge") {
      insertStaticBadge(operation.text);
      result.applied += 1;
      continue;
    }

    const selector = String(operation.selector || "").trim();
    const targets = queryTargets(selector);
    if (!targets.length) continue;

    if (operation.type === "add_class") {
      const className = String(operation.className || "").trim();
      if (!/^[A-Za-z_][A-Za-z0-9_-]{0,80}$/.test(className)) {
        result.skipped.push(`Skipped add_class with invalid class name: ${className}`);
        continue;
      }
      for (const element of targets) {
        element.classList.add(className);
        trackClass(element, className);
        result.applied += 1;
      }
      if (selector.startsWith("body")) {
        document.documentElement.classList.add(className);
        trackClass(document.documentElement, className);
        result.applied += 1;
      }
      continue;
    }

    if (operation.type === "set_style") {
      const styles = operation.styles && typeof operation.styles === "object" && !Array.isArray(operation.styles)
        ? Object.entries(operation.styles).slice(0, 30)
        : [];
      if (!styles.length) {
        result.skipped.push(`Skipped set_style without styles for selector: ${selector}`);
        continue;
      }
      for (const element of targets) {
        rememberStyle(element);
        for (const [property, value] of styles) {
          const propertyName = toKebabCase(property);
          const propertyValue = String(value);
          if (!isSafeCssProperty(propertyName) || isUnsafeCss(propertyValue) || propertyValue.length > 220) {
            result.skipped.push(`Skipped unsafe style declaration: ${propertyName}`);
            continue;
          }
          element.style.setProperty(propertyName, propertyValue);
          result.applied += 1;
        }
      }
      continue;
    }

    if (operation.type === "set_attribute") {
      const name = String(operation.name || "").trim().toLowerCase();
      const value = String(operation.value ?? "").slice(0, 240);
      if (!isAllowedAttribute(name)) {
        result.skipped.push(`Skipped unsafe attribute: ${name}`);
        continue;
      }
      for (const element of targets) {
        rememberAttribute(element, name);
        element.setAttribute(name, value);
        result.applied += 1;
      }
      continue;
    }

    result.skipped.push(`Skipped unsupported operation type: ${operation.type}`);
  }

  if (!fromObserver) {
    installMutationReapplyObserver(plan);
  }

  return result;

  function ensureShell(config = {}) {
    let shell = document.getElementById(SHELL_ID);
    const created = !shell;
    if (!shell) {
      shell = document.createElement("section");
      shell.id = SHELL_ID;
      shell.className = "bridge-shell";
      shell.setAttribute("data-bridge-added", "true");
      shell.setAttribute("aria-label", "Simplified page");
      document.body.prepend(shell);
    }

    if (created) {
      const title = String(config.title || "Simplified page").slice(0, 80);
      const subtitle = String(config.subtitle || "Original page controls are preserved here.").slice(0, 160);
      const header = document.createElement("header");
      header.className = "bridge-shell-header";

      const titleWrap = document.createElement("div");
      const heading = document.createElement("h1");
      heading.textContent = title;
      const body = document.createElement("p");
      body.textContent = subtitle;
      titleWrap.append(heading, body);

      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.className = "bridge-shell-toggle";
      toggle.textContent = "Original page";
      toggle.addEventListener("click", () => {
        document.documentElement.classList.toggle("bridge-show-original");
      });

      header.append(titleWrap, toggle);
      shell.append(header);
    }

    const slots = Array.isArray(config.slots) && config.slots.length ? config.slots : defaultShellSlots();
    for (const slot of slots.slice(0, 8)) {
      ensureShellSlot(slot);
    }
    return shell;
  }

  function defaultShellSlots() {
    return [
      { id: "primary-actions", title: "Start here", description: "The most important original controls." },
      { id: "main-content", title: "Main information", description: "Key content from the current page." },
      { id: "secondary-content", title: "More", description: "Lower-priority original regions kept available." }
    ];
  }

  function ensureShellSlot(slotConfig = {}) {
    const shell = document.getElementById(SHELL_ID) || ensureShell();
    const id = normalizeSlotId(slotConfig.id || "main-content");
    let slot = shell.querySelector(`[data-bridge-shell-slot="${cssEscape(id)}"]`);
    if (slot) return slot;

    slot = document.createElement("section");
    slot.className = "bridge-shell-slot";
    slot.setAttribute("data-bridge-shell-slot", id);

    const heading = document.createElement("h2");
    heading.textContent = String(slotConfig.title || titleFromSlotId(id)).slice(0, 80);
    slot.append(heading);

    const description = String(slotConfig.description || "").trim();
    if (description) {
      const helper = document.createElement("p");
      helper.className = "bridge-shell-slot-description";
      helper.textContent = description.slice(0, 180);
      slot.append(helper);
    }

    const body = document.createElement("div");
    body.className = "bridge-shell-slot-body";
    slot.append(body);
    shell.append(slot);
    return slot;
  }

  function slotBody(slotId) {
    const slot = ensureShellSlot({ id: slotId || "main-content" });
    return slot.querySelector(".bridge-shell-slot-body") || slot;
  }

  function moveNodesToSlot(operation) {
    const targets = queryTargets(String(operation.selector || "").trim()).slice(0, 20);
    if (!targets.length) return;

    const body = slotBody(operation.slot);
    for (const element of targets) {
      if (!canMoveOriginalNode(element)) continue;
      if (hasInteractiveBehavior(element)) {
        createNodeReference(element, operation, body, "Referenced original control");
        result.skipped.push(`Referenced interactive node instead of moving it: ${operation.selector}`);
        result.applied += 1;
        continue;
      }
      const tile = document.createElement("div");
      tile.className = "bridge-shell-node";
      tile.setAttribute("data-bridge-added", "true");

      const label = String(operation.label || "").trim();
      if (label) {
        const labelEl = document.createElement("div");
        labelEl.className = "bridge-shell-node-label";
        labelEl.textContent = label.slice(0, 80);
        tile.append(labelEl);
      }

      rememberOriginalPosition(element);
      tile.append(element);
      body.append(tile);
      result.applied += 1;
    }
  }

  function referenceNodesInSlot(operation) {
    const targets = queryTargets(String(operation.selector || "").trim()).slice(0, 20);
    if (!targets.length) return;

    const body = slotBody(operation.slot);
    for (const element of targets) {
      if (!element || element.closest(`#${SHELL_ID}`)) continue;
      createNodeReference(element, operation, body, "Use original control");
      result.applied += 1;
    }
  }

  function collapseRegionsIntoSlot(operation) {
    const targets = queryTargets(String(operation.selector || "").trim()).slice(0, 20);
    if (!targets.length) return;

    const body = slotBody(operation.slot || "secondary-content");
    for (const element of targets) {
      if (!canMoveOriginalNode(element)) continue;
      if (hasInteractiveBehavior(element)) {
        createNodeReference(element, operation, body, String(operation.title || "Open original section"));
        result.skipped.push(`Referenced interactive region instead of collapsing it: ${operation.selector}`);
        result.applied += 1;
        continue;
      }

      const details = document.createElement("details");
      details.className = "bridge-shell-details";
      details.setAttribute("data-bridge-added", "true");
      const summary = document.createElement("summary");
      summary.textContent = String(operation.title || "More from original page").slice(0, 100);
      details.append(summary);

      rememberOriginalPosition(element);
      details.append(element);
      body.append(details);
      result.applied += 1;
    }
  }

  function createNodeReference(element, operation, body, fallbackLabel) {
    const tile = document.createElement("div");
    tile.className = "bridge-shell-node bridge-shell-reference";
    tile.setAttribute("data-bridge-added", "true");

    const label = String(operation.label || operation.title || getReferenceLabel(element) || fallbackLabel).trim().slice(0, 100);
    const labelEl = document.createElement("div");
    labelEl.className = "bridge-shell-node-label";
    labelEl.textContent = label;
    tile.append(labelEl);

    if (isSafeDirectLink(element)) {
      const link = document.createElement("a");
      link.className = "bridge-shell-reference-action";
      link.href = element.href;
      link.textContent = label;
      tile.append(link);
    } else if (canProxyActivation(element)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bridge-shell-reference-action bridge-shell-proxy-action";
      button.textContent = label;
      button.addEventListener("click", () => activateOriginalNode(element));
      tile.append(button);
    } else {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "bridge-shell-reference-action bridge-shell-reveal-action";
      button.textContent = "Show original";
      button.addEventListener("click", () => revealOriginalNode(element));
      tile.append(button);
    }

    body.append(tile);
  }

  function activateOriginalNode(element) {
    if (!canProxyActivation(element)) {
      revealOriginalNode(element);
      return;
    }
    element.click();
  }

  function revealOriginalNode(element) {
    document.documentElement.classList.add("bridge-show-original");
    element.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    if (typeof element.focus === "function") {
      element.focus({ preventScroll: true });
    }
  }

  function isSafeDirectLink(element) {
    if (!(element instanceof HTMLAnchorElement)) return false;
    const href = element.getAttribute("href") || "";
    return href && !href.startsWith("#") && !/^\s*javascript:/i.test(href);
  }

  function canProxyActivation(element) {
    if (looksLikeSensitiveAction(element)) return false;
    if (element.matches("button,summary,[role='button'],[role='link']")) return true;
    if (element instanceof HTMLAnchorElement) return true;
    if (element instanceof HTMLInputElement) {
      return ["button", "submit", "reset"].includes(String(element.type || "").toLowerCase());
    }
    return false;
  }

  function looksLikeSensitiveAction(element) {
    const text = normalizeText([
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.textContent,
      element.getAttribute("value"),
      element.getAttribute("href")
    ].filter(Boolean).join(" ")).toLowerCase();
    return /buy|purchase|checkout|pay|payment|order|cart|subscribe|결제|구매|주문|장바구니|구독/.test(text);
  }

  function getReferenceLabel(element) {
    return normalizeText(
      element.getAttribute("aria-label")
        || element.getAttribute("title")
        || element.textContent
        || element.getAttribute("value")
        || element.tagName.toLowerCase()
    );
  }

  function hasInteractiveBehavior(element) {
    if (element.matches("a[href],button,input,select,textarea,summary,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='switch'],[role='tab'],[role='menuitem'],[contenteditable='true']")) {
      return true;
    }
    return Boolean(element.querySelector("a[href],button,input,select,textarea,summary,[role='button'],[role='link'],[role='checkbox'],[role='radio'],[role='switch'],[role='tab'],[role='menuitem'],[contenteditable='true']"));
  }

  function canMoveOriginalNode(element) {
    if (!element || element.id === SHELL_ID || element.closest(`#${SHELL_ID}`)) return false;
    if (element.matches("html, body, head, script, style, link, meta, title")) {
      result.skipped.push(`Skipped non-movable node: ${element.tagName.toLowerCase()}`);
      return false;
    }
    return true;
  }

  function rememberOriginalPosition(element) {
    if (element.hasAttribute(MOVED_NODE_ATTR)) return;
    const id = `bridge-moved-${Date.now()}-${movedNodeCounter += 1}`;
    const placeholder = document.createElement("span");
    placeholder.hidden = true;
    placeholder.setAttribute(PLACEHOLDER_ATTR, id);
    element.before(placeholder);
    element.setAttribute(MOVED_NODE_ATTR, id);
  }

  function normalizeSlotId(value) {
    const id = String(value || "main-content").trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
    return /^[a-z][a-z0-9-]{0,60}$/.test(id) ? id : "main-content";
  }

  function titleFromSlotId(id) {
    return id.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }

  function queryTargets(selector) {
    if (!selector || selector.length > 240) {
      result.skipped.push(`Skipped invalid selector: ${selector}`);
      return [];
    }
    try {
      const targets = Array.from(document.querySelectorAll(selector)).slice(0, MAX_TARGETS_PER_OPERATION);
      if (!targets.length) {
        result.skipped.push(`No elements matched selector: ${selector}`);
      }
      return targets;
    } catch {
      result.skipped.push(`Skipped selector that could not be parsed: ${selector}`);
      return [];
    }
  }

  function buildStableCss(css, currentOperations) {
    let stableCss = String(css);
    for (const operation of currentOperations) {
      if (operation?.type !== "add_class") continue;
      const selector = String(operation.selector || "").trim();
      const className = String(operation.className || "").trim();
      if (!selector.startsWith("body") || !className) continue;

      const bodyScope = selector.includes(`.${className}`) ? selector : `${selector}.${className}`;
      const htmlScope = `html.${className} ${selector}`;
      stableCss = stableCss.split(bodyScope).join(htmlScope);
    }
    return stableCss;
  }

  function buildInjectedCss(css, currentOperations) {
    const chunks = [];
    if (currentOperations.some((operation) => ["create_shell", "move_node", "reference_node", "collapse_region"].includes(operation?.type))) {
      chunks.push(defaultShellCss());
    }
    if (typeof css === "string" && css.trim()) {
      if (isUnsafeCss(css)) {
        result.skipped.push("Skipped css because it contains @import, url(), javascript:, or expression().");
      } else {
        chunks.push(buildStableCss(css, currentOperations));
      }
    }

    const operationCss = buildSetStyleCss(currentOperations);
    if (operationCss) chunks.push(operationCss);
    return chunks.join("\n\n").trim();
  }

  function defaultShellCss() {
    return `
html.${SHELL_CLASS}:not(.bridge-show-original) body > :not(#${SHELL_ID}):not(script):not(style):not(link) {
  display: none !important;
}

html.${SHELL_CLASS} body {
  background: #f6f7f9 !important;
  color: #17202a !important;
}

#${SHELL_ID} {
  display: grid !important;
  gap: 16px !important;
  width: min(1120px, calc(100vw - 32px)) !important;
  margin: 24px auto !important;
  padding: 20px !important;
  border: 1px solid #d9dee7 !important;
  border-radius: 10px !important;
  background: #ffffff !important;
  color: #17202a !important;
  font: 15px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif !important;
  box-shadow: 0 18px 45px rgba(15, 23, 42, 0.12) !important;
  position: relative !important;
  z-index: 2147483646 !important;
}

#${SHELL_ID} .bridge-shell-header {
  display: flex !important;
  align-items: flex-start !important;
  justify-content: space-between !important;
  gap: 16px !important;
  border-bottom: 1px solid #e5e7eb !important;
  padding-bottom: 14px !important;
}

#${SHELL_ID} h1,
#${SHELL_ID} h2,
#${SHELL_ID} p {
  margin: 0 !important;
  letter-spacing: 0 !important;
}

#${SHELL_ID} h1 {
  font-size: 24px !important;
  line-height: 1.2 !important;
}

#${SHELL_ID} h2 {
  font-size: 15px !important;
  line-height: 1.25 !important;
}

#${SHELL_ID} p,
#${SHELL_ID} .bridge-shell-slot-description {
  color: #5d6978 !important;
}

#${SHELL_ID} .bridge-shell-toggle,
#${SHELL_ID} :is(a, button, input, select, textarea, [role="button"]) {
  min-height: 40px !important;
  border-radius: 8px !important;
}

#${SHELL_ID} .bridge-shell-toggle {
  border: 1px solid #d9dee7 !important;
  background: #ffffff !important;
  color: #1769aa !important;
  padding: 8px 12px !important;
  cursor: pointer !important;
}

#${SHELL_ID} .bridge-shell-slot {
  display: grid !important;
  gap: 10px !important;
  padding: 14px !important;
  border: 1px solid #e5e7eb !important;
  border-radius: 8px !important;
  background: #fbfcfe !important;
}

#${SHELL_ID} .bridge-shell-slot-body {
  display: flex !important;
  flex-wrap: wrap !important;
  gap: 10px !important;
  align-items: stretch !important;
}

#${SHELL_ID} .bridge-shell-node,
#${SHELL_ID} .bridge-shell-details {
  min-width: min(100%, 220px) !important;
  padding: 10px !important;
  border: 1px solid #d9dee7 !important;
  border-radius: 8px !important;
  background: #ffffff !important;
}

#${SHELL_ID} .bridge-shell-node-label {
  margin-bottom: 6px !important;
  color: #5d6978 !important;
  font-size: 12px !important;
  font-weight: 700 !important;
}

#${SHELL_ID} .bridge-shell-reference-action {
  display: inline-flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 40px !important;
  padding: 8px 12px !important;
  border: 1px solid #1769aa !important;
  border-radius: 8px !important;
  background: #1769aa !important;
  color: #ffffff !important;
  font-weight: 700 !important;
  text-decoration: none !important;
  cursor: pointer !important;
}

#${SHELL_ID} summary {
  cursor: pointer !important;
  font-weight: 700 !important;
}

#${SHELL_ID} :is(a, button, input, select, textarea, summary, [role="button"]):focus-visible {
  outline: 3px solid #0f766e !important;
  outline-offset: 3px !important;
}

@media (max-width: 640px) {
  #${SHELL_ID} {
    width: calc(100vw - 16px) !important;
    margin: 8px auto !important;
    padding: 12px !important;
  }

  #${SHELL_ID} .bridge-shell-header {
    display: grid !important;
  }
}
`.trim();
  }

  function buildSetStyleCss(currentOperations) {
    const rules = [];
    for (const operation of currentOperations) {
      if (operation?.type !== "set_style") continue;
      const selector = String(operation.selector || "").trim();
      if (!selector || selector.length > 240 || !canParseSelector(selector)) continue;

      const styles = operation.styles && typeof operation.styles === "object" && !Array.isArray(operation.styles)
        ? Object.entries(operation.styles).slice(0, 30)
        : [];
      const declarations = [];
      for (const [property, value] of styles) {
        const propertyName = toKebabCase(property);
        const propertyValue = String(value);
        if (!isSafeCssProperty(propertyName) || isUnsafeCss(propertyValue) || propertyValue.length > 220) continue;
        declarations.push(`${propertyName}: ${withImportant(propertyValue)};`);
      }
      if (declarations.length) {
        rules.push(`${selector} { ${declarations.join(" ")} }`);
      }
    }
    return rules.join("\n");
  }

  function canParseSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch {
      return false;
    }
  }

  function withImportant(value) {
    return /!important\s*$/i.test(value) ? value : `${value} !important`;
  }

  function insertStaticBadge(text) {
    let badge = document.getElementById(BADGE_ID);
    if (!badge) {
      badge = document.createElement("div");
      badge.id = BADGE_ID;
      badge.setAttribute("data-bridge-added", "true");
      badge.setAttribute("role", "status");
      document.body.append(badge);
    }
    badge.textContent = String(text || "Bridge UI patch active").slice(0, 80);
  }

  function trackClass(element, className) {
    const classes = new Set((element.getAttribute("data-bridge-patch-classes") || "").split(/\s+/).filter(Boolean));
    classes.add(className);
    element.setAttribute("data-bridge-patch-classes", Array.from(classes).join(" "));
  }

  function rememberStyle(element) {
    if (!element.hasAttribute("data-bridge-prev-style")) {
      element.setAttribute("data-bridge-prev-style", element.getAttribute("style") || MISSING);
    }
  }

  function rememberAttribute(element, name) {
    const list = new Set((element.getAttribute("data-bridge-patch-attrs") || "").split(/\s+/).filter(Boolean));
    list.add(name);
    element.setAttribute("data-bridge-patch-attrs", Array.from(list).join(" "));
    const previousName = `data-bridge-prev-attr-${name}`;
    if (!element.hasAttribute(previousName)) {
      element.setAttribute(previousName, element.hasAttribute(name) ? element.getAttribute(name) : MISSING);
    }
  }

  function isUnsafeCss(value) {
    return /@import|url\s*\(|javascript:|expression\s*\(/i.test(String(value));
  }

  function isSafeCssProperty(property) {
    return /^[a-z-]{1,60}$/.test(property) && !["behavior", "-moz-binding"].includes(property);
  }

  function isAllowedAttribute(name) {
    return name === "title" || name === "aria-label" || /^data-bridge-[a-z0-9-]+$/.test(name);
  }

  function normalizeText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function toKebabCase(property) {
    return String(property).replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`).toLowerCase();
  }

  function installMutationReapplyObserver(currentPlan) {
    if (currentPlan.reapplyOnMutation === false || typeof MutationObserver === "undefined") return;

    window.__bridgeUiPatchPlan = currentPlan;
    if (window.__bridgeUiPatchObserver) return;

    let timer = null;
    window.__bridgeUiPatchObserver = new MutationObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (window.__bridgeUiPatchPlan) {
          applyPatchPlanInPage(window.__bridgeUiPatchPlan, true);
        }
      }, 150);
    });
    window.__bridgeUiPatchObserver.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  }
}

function resetPatchInPage() {
  const STYLE_ID = "bridge-live-ui-patch-style";
  const BADGE_ID = "bridge-live-patch-badge";
  const SHELL_ID = "bridge-simplified-shell";
  const MOVED_NODE_ATTR = "data-bridge-moved-node";
  const PLACEHOLDER_ATTR = "data-bridge-node-placeholder";
  const MISSING = "__BRIDGE_MISSING__";
  let restored = 0;

  if (window.__bridgeUiPatchObserver) {
    window.__bridgeUiPatchObserver.disconnect();
    delete window.__bridgeUiPatchObserver;
  }
  if (window.__bridgeUiPatchSettlingTimer) {
    clearInterval(window.__bridgeUiPatchSettlingTimer);
    delete window.__bridgeUiPatchSettlingTimer;
  }
  delete window.__bridgeUiPatchPlan;

  for (const element of Array.from(document.querySelectorAll(`[${MOVED_NODE_ATTR}]`))) {
    const id = element.getAttribute(MOVED_NODE_ATTR);
    const placeholder = document.querySelector(`[${PLACEHOLDER_ATTR}="${cssEscape(id)}"]`);
    element.removeAttribute(MOVED_NODE_ATTR);
    if (placeholder) {
      placeholder.replaceWith(element);
      restored += 1;
    } else {
      document.body.append(element);
      restored += 1;
    }
  }

  document.getElementById(SHELL_ID)?.remove();
  document.getElementById(STYLE_ID)?.remove();
  document.getElementById(BADGE_ID)?.remove();
  document.documentElement.classList.remove("bridge-live-ui-patch");
  document.documentElement.classList.remove("bridge-simplified-school");
  document.documentElement.classList.remove("bridge-show-original");
  document.documentElement.removeAttribute("data-bridge-ui-patch");

  for (const element of document.querySelectorAll("[data-bridge-patch-classes]")) {
    const classes = (element.getAttribute("data-bridge-patch-classes") || "").split(/\s+/).filter(Boolean);
    for (const className of classes) {
      element.classList.remove(className);
    }
    element.removeAttribute("data-bridge-patch-classes");
    restored += 1;
  }

  for (const element of document.querySelectorAll("[data-bridge-prev-style]")) {
    const previous = element.getAttribute("data-bridge-prev-style");
    if (previous === MISSING) {
      element.removeAttribute("style");
    } else {
      element.setAttribute("style", previous);
    }
    element.removeAttribute("data-bridge-prev-style");
    restored += 1;
  }

  for (const element of document.querySelectorAll("[data-bridge-patch-attrs]")) {
    const names = (element.getAttribute("data-bridge-patch-attrs") || "").split(/\s+/).filter(Boolean);
    for (const name of names) {
      const previousName = `data-bridge-prev-attr-${name}`;
      const previous = element.getAttribute(previousName);
      if (previous === MISSING) {
        element.removeAttribute(name);
      } else if (previous !== null) {
        element.setAttribute(name, previous);
      }
      element.removeAttribute(previousName);
    }
    element.removeAttribute("data-bridge-patch-attrs");
    restored += 1;
  }

  return { restored };

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

function collectPageSnapshot() {
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

    return Array.from(document.querySelectorAll(selectors)).map((element) => ({
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
    return Array.from(document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']")).map((element) => ({
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
      .filter((item) => item.text);
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
      });
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
      .filter((link) => link.text || link.href);
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
      }));
  }

  function collectMedia() {
    return Array.from(document.querySelectorAll("audio, video")).map((element) => ({
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
    return Array.from(document.querySelectorAll("table")).map((table, index) => {
      const headers = Array.from(table.querySelectorAll("th")).map((cell) => truncate(getElementText(cell), 120)).filter(Boolean);
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
    return Array.from(document.querySelectorAll("ul,ol,[role='list']")).map((list, index) => ({
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
    return Array.from(document.querySelectorAll("dialog,[role='dialog'],[role='alertdialog']")).map((dialog) => ({
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
    return Array.from(document.querySelectorAll("[aria-live],[role='alert'],[role='status']")).map((element) => ({
      role: getRole(element),
      ariaLive: getNullableAttribute(element, "aria-live"),
      text: truncate(getElementText(element), 500),
      selector: getCssPath(element),
      bounds: getBounds(element),
      visible: isVisible(element)
    }));
  }

  function collectSelectOptions(select) {
    return Array.from(select.options).map((option) => ({
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

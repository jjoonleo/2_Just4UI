const statusPanelEl = document.getElementById("statusPanel");
const loadingIndicator = document.getElementById("loadingIndicator");
const loadingText = document.getElementById("loadingText");
const statusEl = document.getElementById("status");
const providerSelect = document.getElementById("providerSelect");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const apiKeyInput = document.getElementById("apiKeyInput");
const modelInput = document.getElementById("modelInput");
const taskRequestInput = document.getElementById("taskRequestInput");
const startGuideButton = document.getElementById("startGuideButton");
const clearKeyButton = document.getElementById("clearKeyButton");
const sessionStatusText = document.getElementById("sessionStatusText");
const sessionStatusBadge = document.getElementById("sessionStatusBadge");
const guideActivity = document.getElementById("guideActivity");
const guideActivityText = document.getElementById("guideActivityText");
const sessionTask = document.getElementById("sessionTask");
const sessionStep = document.getElementById("sessionStep");
const sessionIssue = document.getElementById("sessionIssue");
const endGuideButton = document.getElementById("endGuideButton");

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

const SESSION_STATUS_LABELS = {
  noGuide: "No guide",
  planning: "Planning",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  failed: "Failed"
};

const SESSION_STATUS_TEXT = {
  noGuide: "No guide is running.",
  planning: "A guide is being prepared.",
  active: "A guide is active on the current session tab.",
  paused: "The guide is waiting for a supported page.",
  ended: "The guide has ended.",
  failed: "The guide cannot continue."
};

startGuideButton.addEventListener("click", startGuidedTaskMode);
clearKeyButton.addEventListener("click", clearStoredApiKey);
providerSelect.addEventListener("change", updateProviderFields);
endGuideButton.addEventListener("click", endCurrentGuide);

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "BRIDGE_SESSION_CHANGED") return false;
  renderSessionDashboard(message.dashboard);
  return false;
});

restoreGuideSettings();
refreshSessionDashboard();

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

async function refreshSessionDashboard() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_GET_SESSION_DASHBOARD" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load guidance session.");
    }
    renderSessionDashboard(response.dashboard);
  } catch (error) {
    setStatus(error.message || "Failed to load guidance session.", true);
  }
}

async function endCurrentGuide() {
  endGuideButton.disabled = true;
  setStatus("Ending guide...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_END_ACTIVE_GUIDE" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to end guide.");
    }
    setStatus("Guide ended.");
  } catch (error) {
    setStatus(error.message || "Failed to end guide.", true);
  } finally {
    await refreshSessionDashboard();
  }
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
  setStatus("Preparing page evidence for guidance...");

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
    await refreshSessionDashboard();
  } catch (error) {
    setStatus(error.message || "Failed to start Guided Task Mode.", true);
    await refreshSessionDashboard();
  } finally {
    setBusy(false);
  }
}

function setBusy(isBusy, busyText = "Working...") {
  startGuideButton.disabled = isBusy;
  clearKeyButton.disabled = isBusy;
  startGuideButton.textContent = isBusy ? "Working..." : "Start guide";
  statusPanelEl.setAttribute("aria-busy", String(isBusy));
  loadingIndicator.hidden = !isBusy;
  loadingText.textContent = busyText;
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function renderSessionDashboard(dashboard = {}) {
  const status = Object.prototype.hasOwnProperty.call(SESSION_STATUS_LABELS, dashboard.status) ? dashboard.status : "noGuide";
  const activity = dashboard.activity || {};
  const currentStep = dashboard.currentStep;

  sessionStatusBadge.textContent = SESSION_STATUS_LABELS[status];
  sessionStatusBadge.className = `statusBadge ${status}`;
  sessionStatusText.textContent = SESSION_STATUS_TEXT[status];

  guideActivity.hidden = !activity.isWorking;
  guideActivityText.textContent = activity.message || "Preparing guide...";

  sessionTask.textContent = dashboard.taskRequest || "-";
  sessionStep.textContent = currentStep ? `${currentStep.index} of ${currentStep.total}: ${currentStep.title}` : "-";
  sessionIssue.textContent = dashboard.lastIssue || "-";
  endGuideButton.disabled = !dashboard.hasSession || activity.isWorking;
}

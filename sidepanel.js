const statusPanelEl = document.getElementById("statusPanel");
const loadingIndicator = document.getElementById("loadingIndicator");
const loadingText = document.getElementById("loadingText");
const statusEl = document.getElementById("status");
const providerSelect = document.getElementById("providerSelect");
const apiKeyLabel = document.getElementById("apiKeyLabel");
const apiKeyInput = document.getElementById("apiKeyInput");
const modelInput = document.getElementById("modelInput");
const taskRequestInput = document.getElementById("taskRequestInput");
const clarificationPanel = document.getElementById("clarificationPanel");
const clarificationQuestion = document.getElementById("clarificationQuestion");
const clarificationAnswerInput = document.getElementById("clarificationAnswerInput");
const answerClarificationButton = document.getElementById("answerClarificationButton");
const cancelClarificationButton = document.getElementById("cancelClarificationButton");
const startGuideButton = document.getElementById("startGuideButton");
const clearKeyButton = document.getElementById("clearKeyButton");
const sessionStatusText = document.getElementById("sessionStatusText");
const sessionStatusBadge = document.getElementById("sessionStatusBadge");
const guideActivity = document.getElementById("guideActivity");
const guideActivityText = document.getElementById("guideActivityText");
const sessionTask = document.getElementById("sessionTask");
const sessionStep = document.getElementById("sessionStep");
const sessionIssue = document.getElementById("sessionIssue");
const generatedGuideCount = document.getElementById("generatedGuideCount");
const generatedGuideList = document.getElementById("generatedGuideList");
const autoRefreshButton = document.getElementById("autoRefreshButton");
const endGuideButton = document.getElementById("endGuideButton");
let currentAutoRefreshPaused = false;

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
    label: "Gemini API key",
    placeholder: "sk-...",
    model: "gpt-4.1-mini",
    apiKeyStorageKey: GUIDE_STORAGE_KEYS.openAiApiKey,
    modelStorageKey: GUIDE_STORAGE_KEYS.openAiModel
  }
};

const PROVIDER_DISPLAY_LABELS = {
  gemini: "Gemini",
  openai: "Gemini"
};

let clarificationState = null;

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
taskRequestInput.addEventListener("input", resetTaskClarification);
answerClarificationButton.addEventListener("click", answerTaskClarification);
cancelClarificationButton.addEventListener("click", resetTaskClarification);
autoRefreshButton.addEventListener("click", toggleAutoRefresh);
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
  providerSelect.value = "openai";
  if (stored[GUIDE_STORAGE_KEYS.provider] !== "openai") {
    await chrome.storage.local.set({ [GUIDE_STORAGE_KEYS.provider]: "openai" });
  }
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

async function toggleAutoRefresh() {
  const nextPaused = !currentAutoRefreshPaused;
  autoRefreshButton.disabled = true;
  setStatus(nextPaused ? "Pausing automatic refresh..." : "Resuming automatic refresh...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_SET_AUTO_REFRESH", paused: nextPaused });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to update automatic refresh.");
    }
    setStatus(nextPaused ? "Automatic refresh paused." : "Automatic refresh resumed.");
  } catch (error) {
    setStatus(error.message || "Failed to update automatic refresh.", true);
  } finally {
    await refreshSessionDashboard();
  }
}

async function updateProviderFields() {
  const provider = getSelectedProvider();
  resetTaskClarification();
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
  modelInput.value = config.model;
}

function getSelectedProvider() {
  return "openai";
}

async function startGuidedTaskMode() {
  const provider = getSelectedProvider();
  const providerConfig = PROVIDER_DEFAULTS[provider];
  const taskRequest = taskRequestInput.value.trim();
  const apiKey = apiKeyInput.value.trim();
  const model = providerConfig.model;

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
  setStatus("Creating guidance or a clarification question...");

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

    await startGuideWithTaskRequest({ tabId: tab.id, provider, model, taskRequest, history: [] });
  } catch (error) {
    setStatus(error.message || "Failed to start Guided Task Mode.", true);
    await refreshSessionDashboard();
  } finally {
    setBusy(false);
  }
}

async function answerTaskClarification() {
  const answer = clarificationAnswerInput.value.trim();
  if (!clarificationState?.question) {
    setStatus("No clarification question is active.", true);
    return;
  }
  if (!answer) {
    setStatus("Answer the clarification question first.", true);
    clarificationAnswerInput.focus();
    return;
  }

  const history = [
    ...clarificationState.history,
    {
      question: clarificationState.question,
      answer
    }
  ];
  setBusy(true, "Clarifying task...");
  setStatus("Checking whether the task is specific enough...");

  try {
    if (clarificationState.mode === "session") {
      const response = await chrome.runtime.sendMessage({ type: "BRIDGE_ANSWER_CLARIFICATION", answer });
      if (!response?.ok) {
        throw new Error(response?.error || "Failed to answer clarification.");
      }
      resetTaskClarification();
      setStatus("Answer sent. Updating guide...");
      await refreshSessionDashboard();
      return;
    }

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    await startGuideWithTaskRequest({
      tabId: tab.id,
      provider: clarificationState.provider,
      model: clarificationState.model,
      taskRequest: clarificationState.taskRequest,
      history
    });
  } catch (error) {
    setStatus(error.message || "Failed to clarify task.", true);
    await refreshSessionDashboard();
  } finally {
    setBusy(false);
  }
}

async function startGuideWithTaskRequest({ tabId, provider, model, taskRequest, history = [] }) {
  setBusy(true, "Planning guide...");
  setStatus(`Creating guidance with ${PROVIDER_DISPLAY_LABELS[provider] || "Gemini"}...`);
  const response = await chrome.runtime.sendMessage({
    type: "BRIDGE_START_GUIDE",
    tabId,
    provider,
    taskRequest,
    model,
    clarificationHistory: history
  });

  if (!response?.ok) {
    throw new Error(response?.error || "Failed to start Guided Task Mode.");
  }

  const clarification = response.clarification || {};
  if (clarification.question) {
    clarificationState = {
      mode: "start",
      provider,
      model,
      taskRequest,
      history,
      question: clarification.question
    };
    clarificationQuestion.textContent = clarification.question;
    clarificationAnswerInput.value = "";
    clarificationPanel.hidden = false;
    startGuideButton.textContent = "Clarify first";
    setStatus("Answer the clarification question before starting the guide.");
    clarificationAnswerInput.focus();
    return;
  }

  const clarifiedTaskRequest = (response.clarifiedTaskRequest || clarification.clarifiedTaskRequest || taskRequest).trim();
  resetTaskClarification();
  taskRequestInput.value = clarifiedTaskRequest;
  setStatus("Guided Task Mode started. It will follow the active tab in this window.");
  await refreshSessionDashboard();
}

function resetTaskClarification() {
  clarificationState = null;
  clarificationPanel.hidden = true;
  clarificationQuestion.textContent = "-";
  clarificationAnswerInput.value = "";
  startGuideButton.textContent = "Start guide";
  startGuideButton.disabled = false;
}

function setBusy(isBusy, busyText = "Working...") {
  startGuideButton.disabled = isBusy || Boolean(clarificationState?.question);
  clearKeyButton.disabled = isBusy;
  answerClarificationButton.disabled = isBusy;
  cancelClarificationButton.disabled = isBusy;
  startGuideButton.textContent = isBusy ? "Working..." : (clarificationState?.question ? "Clarify first" : "Start guide");
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
  renderGeneratedGuide(dashboard.generatedGuide || []);
  currentAutoRefreshPaused = Boolean(dashboard.autoRefreshPaused);
  autoRefreshButton.textContent = currentAutoRefreshPaused ? "Resume auto refresh" : "Pause auto refresh";
  autoRefreshButton.disabled = !dashboard.canPauseAutoRefresh;
  endGuideButton.disabled = !dashboard.hasSession || activity.isWorking;

  if (dashboard.pendingClarification?.question && (!clarificationState || clarificationState.mode === "session")) {
    const isNewQuestion = clarificationState?.question !== dashboard.pendingClarification.question;
    clarificationState = {
      mode: "session",
      provider: "",
      model: "",
      taskRequest: dashboard.taskRequest || "",
      history: dashboard.pendingClarification.history || [],
      question: dashboard.pendingClarification.question
    };
    clarificationQuestion.textContent = dashboard.pendingClarification.question;
    if (isNewQuestion) clarificationAnswerInput.value = "";
    clarificationPanel.hidden = false;
    startGuideButton.textContent = "Clarify first";
    startGuideButton.disabled = true;
  } else if (!dashboard.pendingClarification && clarificationState?.mode === "session") {
    resetTaskClarification();
  }
}

function renderGeneratedGuide(steps) {
  generatedGuideList.replaceChildren();
  generatedGuideCount.textContent = `${steps.length} ${steps.length === 1 ? "step" : "steps"}`;

  if (!steps.length) {
    const emptyItem = document.createElement("li");
    emptyItem.className = "generatedGuideEmpty";
    emptyItem.textContent = "No generated steps.";
    generatedGuideList.append(emptyItem);
    return;
  }

  for (const step of steps) {
    const item = document.createElement("li");
    const state = normalizeGuideStepState(step.state);
    item.className = `generatedGuideItem ${state}`;

    const marker = document.createElement("span");
    marker.className = "generatedGuideMarker";
    marker.textContent = String(step.number || "");

    const body = document.createElement("div");
    body.className = "generatedGuideBody";

    const titleRow = document.createElement("div");
    titleRow.className = "generatedGuideTitleRow";

    const title = document.createElement("strong");
    title.textContent = step.title || "Untitled step";

    const badge = document.createElement("span");
    badge.className = "generatedGuideState";
    badge.textContent = guideStepStateLabel(state);

    titleRow.append(title, badge);

    const targetText = formatGuideTarget(step.target);
    body.append(titleRow);
    if (step.instruction) {
      const instruction = document.createElement("p");
      instruction.textContent = step.instruction;
      body.append(instruction);
    }
    if (targetText) {
      const target = document.createElement("span");
      target.className = "generatedGuideTarget";
      target.textContent = targetText;
      body.append(target);
    }

    item.append(marker, body);
    generatedGuideList.append(item);
  }
}

function normalizeGuideStepState(state) {
  if (state === "completed" || state === "current") return state;
  return "notCompleted";
}

function guideStepStateLabel(state) {
  if (state === "completed") return "Completed";
  if (state === "current") return "Current";
  return "Not completed";
}

function formatGuideTarget(target = {}) {
  target = target || {};
  const label = target.label || target.text || target.placeholder || target.name || "";
  const role = target.role || "";
  if (role && label) return `${role}: ${label}`;
  return label || role;
}

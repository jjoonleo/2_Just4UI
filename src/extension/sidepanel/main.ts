export {};

type Provider = "backend";
type StoredSettings = Record<string, string | undefined>;
type ProviderConfig = {
  label: string;
  placeholder: string;
  model: string;
  baseUrl?: string;
  baseUrlStorageKey?: string;
};
type ClarificationState = {
  mode: "start" | "session";
  provider: Provider | "";
  model: string;
  taskRequest: string;
  history: Array<{ question?: string; answer?: string }>;
  question: string;
};
type StartClarificationState = ClarificationState & {
  mode: "start";
  provider: Provider;
};
type StartGuideRequest = {
  tabId: number;
  provider: Provider;
  model: string;
  taskRequest: string;
  history?: Array<{ question?: string; answer?: string }>;
};
type GuideStepState = "completed" | "current" | "notCompleted";

const statusPanelEl = getElement<HTMLElement>("statusPanel");
const loadingIndicator = getElement<HTMLElement>("loadingIndicator");
const loadingText = getElement<HTMLElement>("loadingText");
const statusEl = getElement<HTMLElement>("status");
const backendUrlField = getElement<HTMLElement>("backendUrlField");
const backendUrlInput = getElement<HTMLInputElement>("backendUrlInput");
const modelInput = getElement<HTMLInputElement>("modelInput");
const taskRequestInput = getElement<HTMLTextAreaElement>("taskRequestInput");
const clarificationPanel = getElement<HTMLElement>("clarificationPanel");
const clarificationQuestion = getElement<HTMLElement>("clarificationQuestion");
const clarificationAnswerInput = getElement<HTMLTextAreaElement>("clarificationAnswerInput");
const answerClarificationButton = getElement<HTMLButtonElement>("answerClarificationButton");
const cancelClarificationButton = getElement<HTMLButtonElement>("cancelClarificationButton");
const startGuideButton = getElement<HTMLButtonElement>("startGuideButton");
const resetUrlButton = getElement<HTMLButtonElement>("resetUrlButton");
const sessionStatusText = getElement<HTMLElement>("sessionStatusText");
const sessionStatusBadge = getElement<HTMLElement>("sessionStatusBadge");
const guideActivity = getElement<HTMLElement>("guideActivity");
const guideActivityText = getElement<HTMLElement>("guideActivityText");
const sessionTask = getElement<HTMLElement>("sessionTask");
const sessionStep = getElement<HTMLElement>("sessionStep");
const sessionIssue = getElement<HTMLElement>("sessionIssue");
const generatedGuideSection = queryElement<HTMLElement>(".generatedGuide");
const generatedGuideCount = getElement<HTMLElement>("generatedGuideCount");
const generatedGuideList = getElement<HTMLOListElement>("generatedGuideList");
const autoRefreshButton = getElement<HTMLButtonElement>("autoRefreshButton");
const endGuideButton = getElement<HTMLButtonElement>("endGuideButton");
let currentAutoRefreshPaused = false;

const GUIDE_STORAGE_KEYS = {
  provider: "bridgeModelProvider",
  backendBaseUrl: "bridgeBackendBaseUrl"
};
const DEPRECATED_STORAGE_KEYS = [
  "bridgeGeminiApiKey",
  "bridgeGeminiModel",
  "bridgeOpenAiApiKey",
  "bridgeOpenAiModel"
];

const PROVIDER_DEFAULTS: Record<Provider, ProviderConfig> = {
  backend: {
    label: "Backend URL",
    placeholder: "http://localhost:8787",
    model: "backend-proxy",
    baseUrl: "http://localhost:8787",
    baseUrlStorageKey: GUIDE_STORAGE_KEYS.backendBaseUrl
  }
};

const PROVIDER_DISPLAY_LABELS: Record<Provider, string> = {
  backend: "Backend Proxy"
};

let clarificationState: ClarificationState | null = null;

const SESSION_STATUS_LABELS: Record<string, string> = {
  noGuide: "No guide",
  planning: "Planning",
  active: "Active",
  paused: "Paused",
  ended: "Ended",
  failed: "Failed"
};

const SESSION_STATUS_TEXT: Record<string, string> = {
  noGuide: "No guide is running.",
  planning: "A guide is being prepared.",
  active: "A guide is active on the current session tab.",
  paused: "The guide is waiting for a supported page.",
  ended: "The guide has ended.",
  failed: "The guide cannot continue."
};

startGuideButton.addEventListener("click", startGuidedTaskMode);
resetUrlButton.addEventListener("click", resetBackendUrl);
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

function getElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing side panel element: ${id}`);
  return element as T;
}

function queryElement<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing side panel element: ${selector}`);
  return element as T;
}

async function restoreGuideSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(Object.values(GUIDE_STORAGE_KEYS)) as StoredSettings;
  const provider = normalizeProvider(stored[GUIDE_STORAGE_KEYS.provider]);
  if (stored[GUIDE_STORAGE_KEYS.provider] !== provider) {
    await chrome.storage.local.set({ [GUIDE_STORAGE_KEYS.provider]: provider });
  }
  await chrome.storage.local.remove(DEPRECATED_STORAGE_KEYS);
  applyProviderFields(stored);
}

async function resetBackendUrl(): Promise<void> {
  await chrome.storage.local.set({
    [PROVIDER_DEFAULTS.backend.baseUrlStorageKey as string]: PROVIDER_DEFAULTS.backend.baseUrl,
    [GUIDE_STORAGE_KEYS.provider]: "backend"
  });
  backendUrlInput.value = PROVIDER_DEFAULTS.backend.baseUrl || "";
  setStatus("Backend URL reset.");
}

async function refreshSessionDashboard(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_GET_SESSION_DASHBOARD" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to load guidance session.");
    }
    renderSessionDashboard(response.dashboard);
  } catch (error) {
    setStatus(errorMessage(error, "Failed to load guidance session."), true);
  }
}

async function endCurrentGuide(): Promise<void> {
  endGuideButton.disabled = true;
  setStatus("Ending guide...");

  try {
    const response = await chrome.runtime.sendMessage({ type: "BRIDGE_END_ACTIVE_GUIDE" });
    if (!response?.ok) {
      throw new Error(response?.error || "Failed to end guide.");
    }
    setStatus("Guide ended.");
  } catch (error) {
    setStatus(errorMessage(error, "Failed to end guide."), true);
  } finally {
    await refreshSessionDashboard();
  }
}

async function toggleAutoRefresh(): Promise<void> {
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
    setStatus(errorMessage(error, "Failed to update automatic refresh."), true);
  } finally {
    await refreshSessionDashboard();
  }
}

function applyProviderFields(stored: StoredSettings = {}): void {
  const config = PROVIDER_DEFAULTS.backend;
  backendUrlField.hidden = false;
  resetUrlButton.textContent = "Reset URL";
  backendUrlInput.placeholder = PROVIDER_DEFAULTS.backend.placeholder;
  backendUrlInput.value =
    stored[PROVIDER_DEFAULTS.backend.baseUrlStorageKey as string] ||
    PROVIDER_DEFAULTS.backend.baseUrl ||
    "";
  modelInput.value = config.model;
}

function getSelectedProvider(): Provider {
  return "backend";
}

function normalizeProvider(provider: unknown): Provider {
  return "backend";
}

async function startGuidedTaskMode(): Promise<void> {
  const provider = getSelectedProvider();
  const providerConfig = PROVIDER_DEFAULTS[provider];
  const taskRequest = taskRequestInput.value.trim();
  const backendBaseUrl = backendUrlInput.value.trim() || PROVIDER_DEFAULTS.backend.baseUrl || "";
  const model = providerConfig.model;

  if (!taskRequest) {
    setStatus("Enter a task request first.", true);
    taskRequestInput.focus();
    return;
  }

  if (!backendBaseUrl) {
    setStatus("Enter a Backend URL for the proxy.", true);
    backendUrlInput.focus();
    return;
  }

  setBusy(true, "Planning guide...");
  setStatus("Creating guidance or a clarification question...");

  try {
    const settings: Record<string, string> = {
      [GUIDE_STORAGE_KEYS.provider]: provider,
      [PROVIDER_DEFAULTS.backend.baseUrlStorageKey as string]: backendBaseUrl
    };
    await chrome.storage.local.set(settings);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      throw new Error("No active tab found.");
    }

    await startGuideWithTaskRequest({ tabId: tab.id, provider, model, taskRequest, history: [] });
  } catch (error) {
    setStatus(errorMessage(error, "Failed to start Guided Task Mode."), true);
    await refreshSessionDashboard();
  } finally {
    setBusy(false);
  }
}

async function answerTaskClarification(): Promise<void> {
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

    const startClarificationState = clarificationState as StartClarificationState;
    await startGuideWithTaskRequest({
      tabId: tab.id,
      provider: startClarificationState.provider,
      model: startClarificationState.model,
      taskRequest: startClarificationState.taskRequest,
      history
    });
  } catch (error) {
    setStatus(errorMessage(error, "Failed to clarify task."), true);
    await refreshSessionDashboard();
  } finally {
    setBusy(false);
  }
}

async function startGuideWithTaskRequest({
  tabId,
  provider,
  model,
  taskRequest,
  history = []
}: StartGuideRequest): Promise<void> {
  setBusy(true, "Planning guide...");
  setStatus(`Creating guidance with ${PROVIDER_DISPLAY_LABELS[provider] || "Model"}...`);
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

function resetTaskClarification(): void {
  clarificationState = null;
  clarificationPanel.hidden = true;
  clarificationQuestion.textContent = "-";
  clarificationAnswerInput.value = "";
  startGuideButton.textContent = "Start guide";
  startGuideButton.disabled = false;
}

function setBusy(isBusy: boolean, busyText = "Working..."): void {
  startGuideButton.disabled = isBusy || Boolean(clarificationState?.question);
  resetUrlButton.disabled = isBusy;
  answerClarificationButton.disabled = isBusy;
  cancelClarificationButton.disabled = isBusy;
  startGuideButton.textContent = isBusy ? "Working..." : (clarificationState?.question ? "Clarify first" : "Start guide");
  statusPanelEl.setAttribute("aria-busy", String(isBusy));
  loadingIndicator.hidden = !isBusy;
  loadingText.textContent = busyText;
}

function setStatus(message: string, isError = false): void {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
}

function renderSessionDashboard(dashboard: Record<string, any> = {}): void {
  const status = Object.prototype.hasOwnProperty.call(SESSION_STATUS_LABELS, dashboard.status) ? dashboard.status : "noGuide";
  const activity = dashboard.activity || {};
  const currentStep = dashboard.currentStep;

  sessionStatusBadge.textContent = SESSION_STATUS_LABELS[status] || SESSION_STATUS_LABELS.noGuide || "No guide";
  sessionStatusBadge.className = `statusBadge ${status}`;
  sessionStatusText.textContent = SESSION_STATUS_TEXT[status] || SESSION_STATUS_TEXT.noGuide || "No guide is running.";

  guideActivity.hidden = !activity.isWorking;
  guideActivityText.textContent = activity.message || "Preparing guide...";

  sessionTask.textContent = dashboard.taskRequest || "-";
  sessionStep.textContent = currentStep ? `${currentStep.index} of ${currentStep.total}: ${currentStep.title}` : "-";
  sessionIssue.textContent = dashboard.lastIssue || "-";
  generatedGuideSection.hidden = Boolean(dashboard.refreshInProgress);
  renderGeneratedGuide(dashboard.refreshInProgress ? [] : dashboard.generatedGuide || []);
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

function renderGeneratedGuide(steps: Array<Record<string, any>>): void {
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

function normalizeGuideStepState(state: unknown): GuideStepState {
  if (state === "completed" || state === "current") return state;
  return "notCompleted";
}

function guideStepStateLabel(state: GuideStepState): string {
  if (state === "completed") return "Completed";
  if (state === "current") return "Current";
  return "Not completed";
}

function formatGuideTarget(target: Record<string, any> = {}): string {
  target = target || {};
  const label = target.label || target.text || target.placeholder || target.name || "";
  const role = target.role || "";
  if (role && label) return `${role}: ${label}`;
  return label || role;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

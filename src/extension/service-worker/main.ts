// @ts-nocheck
export {};

const SESSION_STORAGE_KEY = "bridgeGuidanceSessions";
const ACTIVITY_STORAGE_KEY = "bridgeGuidanceActivity";
const PAGE_READY_TIMEOUT_MS = 8000;
const PAGE_STABLE_MS = 900;
const PAGE_READY_POLL_MS = 250;
const PAGE_STATE_REFRESH_MIN_INTERVAL_MS = 3500;
const COMPLETION_HANDOFF_WINDOW_MS = 5000;
const GUIDANCE_PLAN_MODES = {
  INITIAL: "initial",
  REFRESH: "refresh",
  CONTINUE_AFTER_WINDOW_ENDED: "continueAfterWindowEnded",
};
const PROVIDER_CONFIG = {
  backend: {
    backendBaseUrlStorageKey: "bridgeBackendBaseUrl",
    defaultBaseUrl: "http://localhost:8787",
    defaultModel: "backend-proxy",
    label: "Backend Proxy",
  },
};
const pageStateRefreshes = new Map();

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
    startGuide(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_GET_SESSION_DASHBOARD") {
    getSessionDashboard()
      .then((dashboard) => sendResponse({ ok: true, dashboard }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_END_ACTIVE_GUIDE") {
    endActiveGuideFromDashboard()
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_SET_AUTO_REFRESH") {
    setAutoRefreshPaused(Boolean(message.paused))
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_ANSWER_CLARIFICATION") {
    answerPendingClarification(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_PAGE_STATE_CHANGED" && sender.tab?.id) {
    handlePageStateChanged(sender.tab.id, message)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "BRIDGE_GUIDE_PROGRESS" && sender.tab?.id) {
    updateProgress(sender.tab.id, message).catch(() => {});
  }

  if (message?.type === "BRIDGE_END_GUIDE" && sender.tab?.id) {
    endActiveSession({ removeOverlay: false, terminalStatus: "ended" }).catch(
      () => {},
    );
  }

  return false;
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;
  refreshAfterNavigation(tabId).catch(() => {});
});

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  moveSessionHost(tabId, windowId).catch(() => {});
});

chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  handleTabRemoved(tabId, removeInfo).catch(() => {});
});

async function startGuide({
  tabId,
  provider = "backend",
  taskRequest,
  model,
  clarificationHistory = [],
}) {
  const modelProvider = normalizeProvider(provider);
  const providerConfig = PROVIDER_CONFIG[modelProvider];

  try {
    await setGuideActivity({
      phase: "extractingPage",
      message: "Waiting for page to load",
      taskRequest,
    });

    const backendBaseUrl = await getBackendBaseUrl(providerConfig);

    const tab = await chrome.tabs.get(tabId);
    if (tab.windowId == null)
      throw new Error("Guide can only start in a browser window tab.");

    const snapshot = await extractSnapshotFromTab(tabId);
    const planningPayload = createPlanningPayload(snapshot);

    await setGuideActivity({
      phase: "askingAi",
      message: `Asking ${providerConfig.label}`,
      taskRequest,
    });

    const selectedModel = providerConfig.defaultModel;
    const planDecision = await createGuidancePlan({
      mode: GUIDANCE_PLAN_MODES.INITIAL,
      provider: modelProvider,
      backendBaseUrl,
      model: selectedModel,
      taskRequest,
      planningPayload,
      previousSession: null,
      clarificationHistory,
    });

    if (planDecision.status === "needsClarification") {
      await clearGuideActivity();
      return {
        ok: true,
        clarification: createClarificationPayload(
          planDecision,
          clarificationHistory,
        ),
      };
    }

    await setGuideActivity({
      phase: "updatingGuide",
      message: "Updating guide",
      taskRequest: planDecision.clarifiedTaskRequest,
    });

    const now = Date.now();
    const session = {
      windowId: tab.windowId,
      hostTabId: tabId,
      provider: modelProvider,
      taskRequest: planDecision.clarifiedTaskRequest,
      model: selectedModel,
      plan: toGuidancePlan(planDecision),
      currentStepIndex: 0,
      completedStepSummaries: [],
      completedStepHistory: [],
      pendingClarification: null,
      status: "active",
      autoRefreshPaused: false,
      consecutiveRefreshFailures: 0,
      createdAt: now,
      updatedAt: now,
    };

    await renderOverlay(tabId, session);
    const previousSession = await getActiveSession();
    await saveActiveSession(session);
    if (previousSession?.hostTabId && previousSession.hostTabId !== tabId) {
      await removeOverlayFromTab(previousSession.hostTabId);
    }
    await clearGuideActivity();
    return {
      ok: true,
      clarifiedTaskRequest: planDecision.clarifiedTaskRequest,
    };
  } catch (error) {
    await clearGuideActivity({
      lastIssue: `New guide failed: ${error.message}`,
    });
    throw error;
  }
}

async function refreshAfterNavigation(tabId) {
  const session = await getActiveSession();
  if (!session || session.hostTabId !== tabId) return;
  clearPageStateRefreshState(tabId);
  await refreshHostTab(tabId, "Guide refreshed for this page.");
}

async function moveSessionHost(tabId, windowId) {
  const session = await getActiveSession();
  if (!session || session.windowId !== windowId) return;
  if (session.hostTabId === tabId) return;

  const previousHostTabId = session.hostTabId;
  if (previousHostTabId) {
    clearPageStateRefreshState(previousHostTabId);
    await removeOverlayFromTab(previousHostTabId);
  }

  const moved = {
    ...session,
    hostTabId: tabId,
    completionHandoff: previousHostTabId
      ? {
          tabId: previousHostTabId,
          expiresAt: Date.now() + COMPLETION_HANDOFF_WINDOW_MS,
        }
      : null,
    updatedAt: Date.now(),
  };
  await saveActiveSession(moved);

  const tab = await chrome.tabs.get(tabId);
  if (tab.status !== "complete") return;
  await refreshHostTab(tabId, "Guide moved to this tab.");
}

async function handleTabRemoved(tabId, removeInfo) {
  clearPageStateRefreshState(tabId);
  const session = await getActiveSession();
  if (
    !session ||
    session.hostTabId !== tabId ||
    session.windowId !== removeInfo.windowId
  )
    return;

  if (removeInfo.isWindowClosing) {
    await saveActiveSession({
      ...session,
      hostTabId: null,
      status: "paused",
      lastError:
        "The session window closed. Start a new guide or end this session from the dashboard.",
      updatedAt: Date.now(),
    });
    return;
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    windowId: session.windowId,
  });
  if (!activeTab?.id) {
    await saveActiveSession({
      ...session,
      hostTabId: null,
      status: "paused",
      lastError: "No active tab is available in the session window.",
      updatedAt: Date.now(),
    });
    return;
  }

  await saveActiveSession({
    ...session,
    hostTabId: activeTab.id,
    completionHandoff: {
      tabId,
      expiresAt: Date.now() + COMPLETION_HANDOFF_WINDOW_MS,
    },
    updatedAt: Date.now(),
  });

  if (activeTab.status !== "complete") return;
  await refreshHostTab(
    activeTab.id,
    "Guide moved after the previous tab closed.",
  );
}

async function refreshHostTab(tabId, message = "", options = {}) {
  const initialSession = await getActiveSession();
  if (!initialSession) return;

  const isPageStateRefresh = options.reason === "pageStateChange";

  try {
    const modelProvider = normalizeProvider(initialSession.provider);
    const providerConfig = PROVIDER_CONFIG[modelProvider];
    const backendBaseUrl = await getBackendBaseUrl(providerConfig);

    await removeOverlayFromTab(tabId);

    await setGuideActivity({
      phase: "extractingPage",
      message: isPageStateRefresh
        ? "Checking the updated UI"
        : "Waiting for page to load",
      taskRequest: initialSession.taskRequest,
    });

    const snapshot = await extractSnapshotFromTab(tabId);
    const planningPayload = createPlanningPayload(snapshot);
    const session = await getActiveSession();
    if (!session || session.hostTabId !== tabId) return;

    await setGuideActivity({
      phase: "askingAi",
      message: isPageStateRefresh
        ? `Asking ${providerConfig.label} for updated guidance`
        : `Asking ${providerConfig.label}`,
      taskRequest: session.taskRequest,
    });

    const refreshedPlanDecision = await createGuidancePlan({
      mode: options.mode || GUIDANCE_PLAN_MODES.REFRESH,
      provider: modelProvider,
      backendBaseUrl,
      model: providerConfig.defaultModel,
      taskRequest: session.taskRequest,
      planningPayload,
      previousSession: summarizeSession(session),
      clarificationHistory:
        options.clarificationHistory ||
        session.pendingClarification?.history ||
        [],
    });

    if (refreshedPlanDecision.status === "needsClarification") {
      await saveActiveSession({
        ...session,
        hostTabId: tabId,
        pendingClarification: createClarificationPayload(
          refreshedPlanDecision,
          options.clarificationHistory ||
            session.pendingClarification?.history ||
            [],
        ),
        status: "active",
        lastError: "",
        updatedAt: Date.now(),
      });
      await clearGuideActivity();
      return;
    }

    await setGuideActivity({
      phase: "updatingGuide",
      message: isPageStateRefresh
        ? "Updating guide for changed page"
        : "Updating guide",
      taskRequest: refreshedPlanDecision.clarifiedTaskRequest,
    });

    const refreshed = {
      ...session,
      hostTabId: tabId,
      taskRequest: refreshedPlanDecision.clarifiedTaskRequest,
      plan: filterCompletedStepsFromPlan(
        session,
        toGuidancePlan(refreshedPlanDecision),
      ),
      currentStepIndex: 0,
      status: "active",
      pendingClarification: null,
      lastError: "",
      consecutiveRefreshFailures: 0,
      updatedAt: Date.now(),
    };
    await saveActiveSession(refreshed);
    await renderOverlay(tabId, refreshed, message);
    await clearGuideActivity();
  } catch (error) {
    if (options.softFailure) {
      await saveActiveSession({
        ...initialSession,
        hostTabId: tabId,
        status: "active",
        lastError: error.message,
        updatedAt: Date.now(),
      });
      try {
        await renderOverlay(tabId, initialSession);
      } catch {}
      await clearGuideActivity({ lastIssue: error.message });
      return;
    }

    await removeOverlayFromTab(tabId);
    await saveActiveSession({
      ...initialSession,
      hostTabId: tabId,
      status: "paused",
      consecutiveRefreshFailures: initialSession.consecutiveRefreshFailures + 1,
      lastError: error.message,
      updatedAt: Date.now(),
    });
    await clearGuideActivity({ lastIssue: error.message });
  }
}

async function handlePageStateChanged(tabId, message = {}) {
  const session = await getActiveSession();
  if (!session || session.hostTabId !== tabId || session.status !== "active")
    return { ok: true, skipped: true };

  if (Number.isInteger(message.currentStepIndex) || message.completedStep) {
    await updateProgress(tabId, message);
  }

  const latest = await getActiveSession();
  if (!latest || latest.hostTabId !== tabId || latest.autoRefreshPaused)
    return { ok: true, skipped: true };

  queuePageStateRefresh(
    tabId,
    message.reason || "page state changed",
    plannerModeFromRefreshReason(message.reason),
  );
  return { ok: true };
}

function queuePageStateRefresh(
  tabId,
  reason = "page state changed",
  mode = GUIDANCE_PLAN_MODES.REFRESH,
) {
  const state = getPageStateRefreshState(tabId);
  state.reason = reason;
  state.mode = mode;

  if (state.inFlight) {
    state.queued = true;
    pageStateRefreshes.set(tabId, state);
    return;
  }

  const delayMs = Math.max(
    0,
    PAGE_STATE_REFRESH_MIN_INTERVAL_MS - (Date.now() - state.lastStartedAt),
  );
  if (delayMs > 0) {
    state.queued = true;
    if (!state.timerId) {
      state.timerId = setTimeout(() => {
        const scheduled = getPageStateRefreshState(tabId);
        scheduled.timerId = null;
        scheduled.queued = false;
        pageStateRefreshes.set(tabId, scheduled);
        runPageStateRefresh(tabId, scheduled.reason, scheduled.mode).catch(
          () => {},
        );
      }, delayMs);
    }
    pageStateRefreshes.set(tabId, state);
    return;
  }

  runPageStateRefresh(tabId, reason, mode).catch(() => {});
}

async function runPageStateRefresh(
  tabId,
  reason = "page state changed",
  mode = GUIDANCE_PLAN_MODES.REFRESH,
) {
  const state = getPageStateRefreshState(tabId);
  if (state.inFlight) {
    state.queued = true;
    state.mode = mode;
    pageStateRefreshes.set(tabId, state);
    return;
  }

  state.inFlight = true;
  state.queued = false;
  state.reason = reason;
  state.mode = mode;
  state.lastStartedAt = Date.now();
  if (state.timerId) clearTimeout(state.timerId);
  state.timerId = null;
  pageStateRefreshes.set(tabId, state);

  try {
    const session = await getActiveSession();
    if (
      !session ||
      session.hostTabId !== tabId ||
      session.autoRefreshPaused ||
      session.status !== "active"
    )
      return;
    await refreshHostTab(tabId, "Guide refreshed for the changed page.", {
      reason: "pageStateChange",
      mode,
      softFailure: true,
    });
  } finally {
    const latest = getPageStateRefreshState(tabId);
    latest.inFlight = false;
    const shouldRunAgain = latest.queued;
    latest.queued = false;
    pageStateRefreshes.set(tabId, latest);
    if (shouldRunAgain)
      queuePageStateRefresh(tabId, latest.reason, latest.mode);
  }
}

function getPageStateRefreshState(tabId) {
  return (
    pageStateRefreshes.get(tabId) || {
      inFlight: false,
      queued: false,
      timerId: null,
      lastStartedAt: 0,
      reason: "",
      mode: GUIDANCE_PLAN_MODES.REFRESH,
    }
  );
}

function plannerModeFromRefreshReason(reason = "") {
  return reason === "user requested next step"
    ? GUIDANCE_PLAN_MODES.CONTINUE_AFTER_WINDOW_ENDED
    : GUIDANCE_PLAN_MODES.REFRESH;
}

async function updateProgress(tabId, message) {
  const session = await getActiveSession();
  const progressSource = getProgressSource(session, tabId, message);
  if (!progressSource.allowed) return;

  const nextIndex = Number.isInteger(message.currentStepIndex)
    ? message.currentStepIndex
    : session.currentStepIndex;
  const completedStep = message.completedStep;
  const completedStepSummaries = [...(session.completedStepSummaries || [])];
  const completedStepHistory = [...(session.completedStepHistory || [])];
  if (completedStep && !completedStepSummaries.includes(completedStep)) {
    completedStepSummaries.push(completedStep);
  }
  const completedStepRecord = normalizeCompletedStepRecord(
    message.completedStepRecord,
    completedStep,
  );
  if (
    completedStepRecord &&
    !hasCompletedStepRecord(completedStepHistory, completedStepRecord)
  ) {
    completedStepHistory.push(completedStepRecord);
  }

  const latestSession = await getActiveSession();
  const sessionForSave = latestSession || session;
  const mergedSummaries = mergeCompletedStepSummaries(
    sessionForSave.completedStepSummaries || [],
    completedStepSummaries,
  );
  const mergedHistory = mergeCompletedStepHistory(
    sessionForSave.completedStepHistory || [],
    completedStepHistory,
  );
  const shouldUpdateStepIndex = isSameGuidancePlan(
    sessionForSave.plan,
    session.plan,
  );

  await saveActiveSession({
    ...sessionForSave,
    currentStepIndex: shouldUpdateStepIndex
      ? Math.max(sessionForSave.currentStepIndex || 0, nextIndex)
      : sessionForSave.currentStepIndex,
    completedStepSummaries: mergedSummaries,
    completedStepHistory: mergedHistory,
    completionHandoff: progressSource.fromCompletionHandoff
      ? null
      : clearExpiredCompletionHandoff(sessionForSave.completionHandoff),
    updatedAt: Date.now(),
  });
}

function getProgressSource(session, tabId, message = {}) {
  if (!session) return { allowed: false, fromCompletionHandoff: false };
  if (session.hostTabId === tabId)
    return { allowed: true, fromCompletionHandoff: false };

  const handoff = clearExpiredCompletionHandoff(session.completionHandoff);
  const hasCompletedRecord = Boolean(
    message.completedStepRecord &&
    typeof message.completedStepRecord === "object" &&
    normalizeCompletedStepRecord(message.completedStepRecord, ""),
  );
  if (handoff?.tabId === tabId && hasCompletedRecord) {
    return { allowed: true, fromCompletionHandoff: true };
  }

  return { allowed: false, fromCompletionHandoff: false };
}

function clearExpiredCompletionHandoff(handoff) {
  if (!handoff?.tabId || !Number.isFinite(handoff.expiresAt)) return null;
  return Date.now() <= handoff.expiresAt ? handoff : null;
}

function hasCompletedStepRecord(history, record) {
  const recordKeys = guideListStepKeys(
    compactGuideListStep(record, "completed"),
    history.length,
  );
  return history.some((step, index) => {
    const existingKeys = guideListStepKeys(
      compactGuideListStep(step, "completed"),
      index,
    );
    return recordKeys.some((key) => existingKeys.includes(key));
  });
}

function mergeCompletedStepSummaries(existing, incoming) {
  const merged = [...existing];
  for (const item of incoming) {
    if (item && !merged.includes(item)) merged.push(item);
  }
  return merged;
}

function mergeCompletedStepHistory(existing, incoming) {
  const merged = [...existing];
  for (const record of incoming) {
    if (record && !hasCompletedStepRecord(merged, record)) merged.push(record);
  }
  return merged;
}

function isSameGuidancePlan(left, right) {
  const leftSteps = Array.isArray(left?.steps) ? left.steps : [];
  const rightSteps = Array.isArray(right?.steps) ? right.steps : [];
  if (leftSteps.length !== rightSteps.length) return false;
  return leftSteps.every((step, index) => {
    const other = rightSteps[index];
    return (
      step?.id === other?.id &&
      step?.title === other?.title &&
      step?.instruction === other?.instruction
    );
  });
}

function normalizeCompletedStepRecord(record, fallbackTitle = "") {
  if (record && typeof record === "object") {
    return {
      id:
        typeof record.id === "string" && record.id.trim()
          ? record.id.trim()
          : `completed-${Date.now()}`,
      title: stringOrNull(record.title) || fallbackTitle || "Completed step",
      instruction: stringOrNull(record.instruction) || "",
      target: normalizeTarget(
        record.target && typeof record.target === "object" ? record.target : {},
      ),
      completionType: stringOrNull(record.completionType) || "",
      completionMode: stringOrNull(record.completionMode) || "manual",
      completedAt: stringOrNull(record.completedAt) || new Date().toISOString(),
    };
  }

  if (!fallbackTitle) return null;
  return {
    id: `completed-${Date.now()}`,
    title: fallbackTitle,
    instruction: "",
    target: normalizeTarget({}),
    completionType: "",
    completionMode: "manual",
    completedAt: new Date().toISOString(),
  };
}

async function setAutoRefreshPaused(paused) {
  const session = await getActiveSession();
  if (!session) return { ok: true };

  const updated = {
    ...session,
    autoRefreshPaused: paused,
    updatedAt: Date.now(),
  };
  if (paused && updated.hostTabId)
    clearPageStateRefreshState(updated.hostTabId);
  await saveActiveSession(updated);
  if (updated.hostTabId) {
    await renderOverlay(
      updated.hostTabId,
      updated,
      paused ? "Automatic refresh paused." : "Automatic refresh resumed.",
    );
  }
  return { ok: true };
}

async function answerPendingClarification({ answer }) {
  const session = await getActiveSession();
  if (!session?.pendingClarification)
    throw new Error("No clarification question is active.");
  if (!session.hostTabId)
    throw new Error(
      "No active session tab is available for this clarification.",
    );
  const normalizedAnswer = stringOrNull(answer);
  if (!normalizedAnswer) throw new Error("Clarification answer is missing.");

  const history = [
    ...(session.pendingClarification.history || []),
    {
      question: session.pendingClarification.question,
      answer: normalizedAnswer,
    },
  ];

  await saveActiveSession({
    ...session,
    pendingClarification: {
      ...session.pendingClarification,
      history,
      answeredAt: new Date().toISOString(),
    },
    updatedAt: Date.now(),
  });
  await refreshHostTab(session.hostTabId, "Guide updated from your answer.", {
    clarificationHistory: history,
  });
  return { ok: true };
}

async function extractSnapshotFromTab(tabId) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: waitForGuidePageReady,
    args: [
      {
        timeoutMs: PAGE_READY_TIMEOUT_MS,
        stableMs: PAGE_STABLE_MS,
        pollMs: PAGE_READY_POLL_MS,
      },
    ],
  });

  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: collectPageSnapshotForGuide,
  });
  if (!result) throw new Error("Page snapshot could not be extracted.");
  return result;
}

async function renderOverlay(tabId, session, message = "") {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: installGuidedTaskOverlay,
    args: [
      session.plan,
      {
        currentStepIndex: session.currentStepIndex || 0,
        message,
        autoRefreshPaused: Boolean(session.autoRefreshPaused),
      },
    ],
  });
}

async function removeOverlayFromTab(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: removeGuidedTaskOverlay,
    });
  } catch {}
}

async function getSessionDashboard() {
  const [session, activity] = await Promise.all([
    getActiveSession(),
    getGuideActivity(),
  ]);
  return createSessionDashboard(session, activity);
}

async function endActiveGuideFromDashboard() {
  await setGuideActivity({
    phase: "endingGuide",
    message: "Ending guide",
  });
  await endActiveSession({
    removeOverlay: true,
    clearActivity: false,
    notify: false,
  });
  await clearGuideActivity({ terminalStatus: "ended" });
  return { ok: true };
}

async function getActiveSession() {
  const stored = await chrome.storage.local.get(SESSION_STORAGE_KEY);
  const session = stored[SESSION_STORAGE_KEY];
  return session?.taskRequest ? session : null;
}

async function saveActiveSession(session) {
  await chrome.storage.local.set({ [SESSION_STORAGE_KEY]: session });
  await notifyDashboardChanged();
}

async function endActiveSession({
  removeOverlay = false,
  clearActivity = true,
  terminalStatus = "ended",
  lastIssue = "",
  notify = true,
} = {}) {
  const session = await getActiveSession();
  if (session?.hostTabId) clearPageStateRefreshState(session.hostTabId);
  if (removeOverlay && session?.hostTabId)
    await removeOverlayFromTab(session.hostTabId);
  await chrome.storage.local.remove(SESSION_STORAGE_KEY);
  if (clearActivity) {
    await clearGuideActivity({ terminalStatus, lastIssue, notify });
  } else if (notify) {
    await notifyDashboardChanged();
  }
}

function clearPageStateRefreshState(tabId) {
  const state = pageStateRefreshes.get(tabId);
  if (state?.timerId) clearTimeout(state.timerId);
  pageStateRefreshes.delete(tabId);
}

async function getGuideActivity() {
  const stored = await chrome.storage.local.get(ACTIVITY_STORAGE_KEY);
  return stored[ACTIVITY_STORAGE_KEY] || null;
}

async function setGuideActivity({ phase, message, taskRequest = "" }) {
  const now = Date.now();
  const previous = await getGuideActivity();
  await chrome.storage.local.set({
    [ACTIVITY_STORAGE_KEY]: {
      isWorking: true,
      phase,
      message,
      taskRequest,
      startedAt: previous?.isWorking ? previous.startedAt : now,
      updatedAt: now,
      lastIssue: previous?.lastIssue || "",
      terminalStatus: "",
    },
  });
  await notifyDashboardChanged();
}

async function clearGuideActivity({
  lastIssue = "",
  terminalStatus = "",
  notify = true,
} = {}) {
  const previous = await getGuideActivity();
  const nextActivity = {
    isWorking: false,
    phase: "",
    message: "",
    taskRequest: "",
    startedAt: previous?.startedAt || null,
    updatedAt: Date.now(),
    lastIssue,
    terminalStatus,
  };
  await chrome.storage.local.set({ [ACTIVITY_STORAGE_KEY]: nextActivity });
  if (notify) await notifyDashboardChanged();
}

function createSessionDashboard(session, activity) {
  const isWorking = Boolean(activity?.isWorking);
  const refreshInProgress = isRefreshActivity(session, activity);
  const status = getDashboardStatus(session, activity);
  const currentStep = refreshInProgress ? null : getCurrentStepSummary(session);
  const lastIssue = session?.lastError || activity?.lastIssue || "";

  return {
    status,
    hasSession: Boolean(session),
    taskRequest: session?.taskRequest || activity?.taskRequest || "",
    currentStep,
    generatedGuide: refreshInProgress ? [] : buildGeneratedGuideSummary(session),
    refreshInProgress,
    lastIssue,
    pendingClarification: session?.pendingClarification || null,
    autoRefreshPaused: Boolean(session?.autoRefreshPaused),
    canPauseAutoRefresh: Boolean(session && session.status === "active"),
    activity: {
      isWorking,
      phase: activity?.phase || "",
      message: activity?.message || "",
      startedAt: activity?.startedAt || null,
      updatedAt: activity?.updatedAt || null,
    },
    updatedAt:
      Math.max(
        Number(session?.updatedAt || 0),
        Number(activity?.updatedAt || 0),
      ) || Date.now(),
  };
}

function isRefreshActivity(session, activity) {
  if (!session || !activity?.isWorking) return false;
  return ["extractingPage", "askingAi", "updatingGuide"].includes(
    activity.phase,
  );
}

function getDashboardStatus(session, activity) {
  if (session?.status === "paused") return "paused";
  if (session?.status === "active") return "active";
  if (activity?.isWorking) return "planning";
  if (activity?.terminalStatus === "ended") return "ended";
  if (activity?.terminalStatus === "failed") return "failed";
  return "noGuide";
}

function buildGeneratedGuideSummary(session) {
  if (!session) return [];
  const currentStepIndex = Math.max(0, session.currentStepIndex || 0);
  const steps = Array.isArray(session.plan?.steps) ? session.plan.steps : [];
  const items = [];
  const seen = new Set();

  for (const step of session.completedStepHistory || []) {
    const item = compactGuideListStep(step, "completed");
    const keys = guideListStepKeys(item, items.length);
    if (keys.some((key) => seen.has(key))) continue;
    keys.forEach((key) => seen.add(key));
    items.push(item);
  }

  steps.forEach((step, index) => {
    const state =
      index < currentStepIndex
        ? "completed"
        : index === currentStepIndex
          ? "current"
          : "notCompleted";
    const item = compactGuideListStep(step, state);
    const keys = guideListStepKeys(item, index);
    if (keys.some((key) => seen.has(key))) {
      return;
    }
    keys.forEach((key) => seen.add(key));
    items.push(item);
  });

  return items.map((item, index) => ({ ...item, number: index + 1 }));
}

function filterCompletedStepsFromPlan(session, plan) {
  const completedKeys = new Set();
  (session?.completedStepHistory || []).forEach((step, index) => {
    guideListStepKeys(compactGuideListStep(step, "completed"), index).forEach(
      (key) => completedKeys.add(key),
    );
  });
  if (!completedKeys.size) return plan;

  return {
    ...plan,
    steps: (plan.steps || []).filter((step, index) => {
      const keys = guideListStepKeys(
        compactGuideListStep(step, "notCompleted"),
        index,
      );
      return !keys.some((key) => completedKeys.has(key));
    }),
  };
}

function compactGuideListStep(step, state) {
  return compactObject({
    id: step.id,
    title: step.title || "Untitled step",
    instruction: step.instruction || "",
    state,
    target: compactContinuationTarget(step.target),
    completionType: step.completionType || step.completion?.type || "",
  });
}

function guideListStepKeys(step, fallbackIndex) {
  const keys = [];
  if (step.id) keys.push(`id:${step.id}`);
  const evidence = [
    step.title,
    step.instruction,
    step.target?.role,
    step.target?.label,
    step.target?.text,
  ]
    .filter(Boolean)
    .join("|");
  if (evidence) keys.push(`evidence:${evidence}`);
  if (!keys.length) keys.push(`fallback:${fallbackIndex}`);
  return keys;
}

function getCurrentStepSummary(session) {
  if (!session?.plan?.steps?.length) return null;
  const total = session.plan.steps.length;
  if ((session.currentStepIndex || 0) >= total) {
    return {
      index: total,
      total,
      title: "Waiting for your decision",
    };
  }
  const currentStepIndex = Math.max(0, session.currentStepIndex || 0);
  const step = session.plan.steps[currentStepIndex];
  return {
    index: currentStepIndex + 1,
    total,
    title: step?.title || "",
  };
}

async function notifyDashboardChanged() {
  try {
    const dashboard = await getSessionDashboard();
    await chrome.runtime.sendMessage({
      type: "BRIDGE_SESSION_CHANGED",
      dashboard,
    });
  } catch {}
}

function summarizeSession(session) {
  const currentStepIndex = session.currentStepIndex || 0;
  const steps = session.plan?.steps || [];
  const completedStepHistory = (session.completedStepHistory || []).map(
    compactCompletedStep,
  );
  const currentStep = steps[currentStepIndex]
    ? compactGuidanceStepForContinuation(steps[currentStepIndex])
    : null;
  const aheadSteps = steps
    .slice(currentStepIndex + 1)
    .map(compactGuidanceStepForContinuation);
  const visibleStepWindow = steps.map((step, index) =>
    compactObject({
      index,
      state:
        index < currentStepIndex
          ? "past-window"
          : index === currentStepIndex
            ? "current"
            : "ahead",
      step: compactGuidanceStepForContinuation(step),
    }),
  );
  return {
    taskRequest: session.taskRequest,
    currentStepIndex,
    lockedStepCount: (session.completedStepHistory || []).length,
    includedCompletedStepCount: completedStepHistory.length,
    completedStepSummaries: session.completedStepSummaries || [],
    completedStepHistory,
    previousSummary: session.plan?.summary || "",
    currentStep,
    aheadSteps,
    planSoFar: compactObject({
      summary: session.plan?.summary || "",
      completedStepHistory,
      currentStep,
      aheadSteps,
      visibleStepWindow,
    }),
  };
}

function compactCompletedStep(step) {
  return compactObject({
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    target: compactContinuationTarget(step.target),
    completionType: step.completionType,
    completionMode: step.completionMode,
    completedAt: step.completedAt,
  });
}

function compactGuidanceStepForContinuation(step) {
  if (!step || typeof step !== "object") return null;
  return compactObject({
    id: step.id,
    title: step.title,
    instruction: step.instruction,
    target: compactContinuationTarget(step.target),
    completion: compactObject({
      type: step.completion?.type,
    }),
    risk: step.risk,
  });
}

function compactContinuationTarget(target = {}) {
  return compactObject({
    role: target.role,
    label: target.label,
    text: target.text,
    href: target.href,
    selector: target.selector,
    name: target.name,
    placeholder: target.placeholder,
  });
}

function normalizeProvider(provider) {
  if (provider !== "backend") return "backend";
  return "backend";
}

async function getBackendBaseUrl(providerConfig) {
  const stored = await chrome.storage.local.get(
    providerConfig.backendBaseUrlStorageKey,
  );
  const backendBaseUrl =
    stringOrNull(stored[providerConfig.backendBaseUrlStorageKey]) ||
    providerConfig.defaultBaseUrl;
  if (!backendBaseUrl) throw new Error(`${providerConfig.label} URL is missing.`);
  return backendBaseUrl;
}

function createPlanningPayload(snapshot) {
  const content = snapshot.content || {};
  const textBlocks = (content.textBlocks || []).filter((item) =>
    ["pageTitle", "sectionHeading", "mainContent", "content"].includes(
      item.importance,
    ),
  );

  return compactObject({
    page: pick(snapshot.page, [
      "url",
      "origin",
      "title",
      "language",
      "metaDescription",
      "canonicalUrl",
    ]),
    viewport: pick(snapshot.viewport, [
      "width",
      "height",
      "scrollX",
      "scrollY",
      "documentWidth",
      "documentHeight",
    ]),
    headings: (content.headings || []).slice(0, 80).map((item) =>
      compactObject({
        level: item.level,
        text: item.text,
        selector: item.selector,
        bounds: compactBounds(item.bounds),
      }),
    ),
    landmarks: (content.landmarks || []).slice(0, 60).map((item) =>
      compactObject({
        role: item.role,
        label: item.label,
        textPreview: item.textPreview,
        selector: item.selector,
        bounds: compactBounds(item.bounds),
      }),
    ),
    interactiveElements: (content.interactiveElements || [])
      .slice(0, 180)
      .map((item) =>
        compactObject({
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
          bounds: compactBounds(item.bounds),
        }),
      ),
    forms: (content.forms || []).slice(0, 20),
    links: (content.links || []).slice(0, 160),
    textBlocks: textBlocks.slice(0, 160).map((item) =>
      compactObject({
        tag: item.tag,
        role: item.role,
        text: item.text,
        importance: item.importance,
        selector: item.selector,
        bounds: compactBounds(item.bounds),
      }),
    ),
  });
}

async function createGuidancePlan({
  mode = GUIDANCE_PLAN_MODES.INITIAL,
  provider,
  backendBaseUrl,
  taskRequest,
  planningPayload,
  previousSession,
  clarificationHistory = [],
}) {
  const normalizedMode = normalizeGuidancePlanMode(mode);
  if (provider !== "backend") throw new Error("Only Backend Proxy is supported.");
  return createBackendGuidancePlan({
    mode: normalizedMode,
    backendBaseUrl,
    taskRequest,
    planningPayload,
    previousSession,
    clarificationHistory,
  });
}

function normalizeGuidancePlanMode(mode) {
  return Object.values(GUIDANCE_PLAN_MODES).includes(mode)
    ? mode
    : GUIDANCE_PLAN_MODES.REFRESH;
}

function maxStepsForGuidancePlanMode(mode) {
  return mode === GUIDANCE_PLAN_MODES.REFRESH ? 8 : 2;
}

async function createBackendGuidancePlan({
  mode,
  backendBaseUrl,
  taskRequest,
  planningPayload,
  previousSession,
  clarificationHistory,
}) {
  const endpoint = `${normalizeBackendBaseUrl(backendBaseUrl)}/guidance-plan`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contractVersion: 1,
      mode,
      taskRequest,
      planningPayload,
      previousSession,
      clarificationHistory: compactClarificationHistory(clarificationHistory),
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      data?.error || `Backend Proxy request failed with HTTP ${response.status}.`,
    );
  }
  return validateGuidancePlan(data, taskRequest, mode);
}

function normalizeBackendBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Backend Proxy URL is missing.");
  return trimmed;
}

function compactClarificationHistory(history) {
  return (Array.isArray(history) ? history : []).slice(-6).map((item) =>
    compactObject({
      question: stringOrNull(item?.question),
      answer: stringOrNull(item?.answer),
    }),
  );
}

function createClarificationPayload(planDecision, history = []) {
  return {
    question: planDecision.question,
    clarifiedTaskRequest: planDecision.clarifiedTaskRequest,
    assumptions: planDecision.assumptions || [],
    history: compactClarificationHistory(history),
  };
}

function toGuidancePlan(planDecision) {
  return {
    summary: planDecision.summary,
    assumptions: planDecision.assumptions || [],
    steps: planDecision.steps || [],
  };
}

function validateGuidancePlan(
  plan,
  fallbackTaskRequest = "",
  mode = GUIDANCE_PLAN_MODES.INITIAL,
) {
  if (!plan || typeof plan !== "object")
    throw new Error("Guidance plan must be an object.");
  const normalizedMode = normalizeGuidancePlanMode(mode);
  const maxSteps = maxStepsForGuidancePlanMode(normalizedMode);
  const status =
    plan.status === "needsClarification" ? "needsClarification" : "ready";
  const question = stringOrNull(plan.question) || "";
  const clarifiedTaskRequest =
    stringOrNull(plan.clarifiedTaskRequest) || fallbackTaskRequest;
  const assumptions = Array.isArray(plan.assumptions)
    ? plan.assumptions
        .filter((item) => typeof item === "string" && item.trim())
        .slice(0, 3)
    : [];
  if (!clarifiedTaskRequest)
    throw new Error("Clarified task request is missing.");

  if (status === "needsClarification") {
    if (!question) throw new Error("Task clarification question is missing.");
    if (Array.isArray(plan.steps) && plan.steps.length)
      throw new Error(
        "Task clarification response must not include guidance steps.",
      );
    return {
      status,
      question,
      clarifiedTaskRequest,
      assumptions,
      steps: [],
    };
  }

  if (typeof plan.summary !== "string" || !plan.summary.trim())
    throw new Error("Guidance plan summary is missing.");
  if (!Array.isArray(plan.steps) || !plan.steps.length)
    throw new Error("Guidance plan must include at least one step.");
  if (plan.steps.length > maxSteps)
    throw new Error(
      `Guidance plan for ${normalizedMode} must include at most ${maxSteps} steps.`,
    );

  return {
    status,
    question: "",
    clarifiedTaskRequest,
    summary: plan.summary.trim(),
    assumptions,
    steps: plan.steps.map((step, index) => {
      if (!step || typeof step !== "object")
        throw new Error(`Step ${index + 1} is invalid.`);
      if (typeof step.title !== "string" || !step.title.trim())
        throw new Error(`Step ${index + 1} is missing a title.`);
      if (typeof step.instruction !== "string" || !step.instruction.trim())
        throw new Error(`Step ${index + 1} is missing an instruction.`);
      if (!step.target || typeof step.target !== "object")
        throw new Error(`Step ${index + 1} is missing a target.`);
      return {
        id:
          typeof step.id === "string" && step.id.trim()
            ? step.id
            : `step-${index + 1}`,
        title: step.title.trim(),
        instruction: step.instruction.trim(),
        target: normalizeTarget(step.target),
        completion: normalizeCompletion(step.completion, step.target),
        risk: ["low", "medium", "high"].includes(step.risk) ? step.risk : "low",
      };
    }),
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
    bounds:
      target.bounds && typeof target.bounds === "object" ? target.bounds : null,
  };
}

function normalizeCompletion(completion, target = {}) {
  if (!completion || typeof completion !== "object") {
    return {
      type: isClickableTarget(target) ? "click" : "manual",
      value: null,
    };
  }
  const type =
    typeof completion.type === "string" && completion.type.trim()
      ? completion.type.trim()
      : "manual";
  return {
    type: type === "manual" && isClickableTarget(target) ? "click" : type,
    value: completion.value == null ? null : String(completion.value),
  };
}

function isClickableTarget(target = {}) {
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
    inViewport: bounds.inViewport,
  });
}

function pick(source, keys) {
  const target = {};
  for (const key of keys) target[key] = source?.[key];
  return compactObject(target);
}

function compactObject(object) {
  return Object.fromEntries(
    Object.entries(object || {}).filter(
      ([, value]) => value !== undefined && value !== null && value !== "",
    ),
  );
}

async function waitForGuidePageReady({
  timeoutMs = 8000,
  stableMs = 900,
  pollMs = 250,
} = {}) {
  const startedAt = Date.now();
  let lastSignature = "";
  let stableSince = 0;
  const getSignature = () => {
    const body = document.body;
    const text = (body?.innerText || body?.textContent || "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 1000);
    const interactiveCount = body
      ? document.querySelectorAll(
          "a[href],button,input,select,textarea,summary,[role],[tabindex]:not([tabindex='-1']),[contenteditable='true']",
        ).length
      : 0;
    const headingCount = body
      ? document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']").length
      : 0;
    const busyCount = body
      ? document.querySelectorAll(
          "[aria-busy='true'],[role='progressbar'],[role='status']",
        ).length
      : 0;

    return {
      readyState: document.readyState,
      isReadyStateSettled:
        document.readyState === "interactive" ||
        document.readyState === "complete",
      hasBody: Boolean(body),
      textLength: text.length,
      interactiveCount,
      headingCount,
      busyCount,
      value: [
        document.readyState,
        location.href,
        document.title,
        text.length,
        interactiveCount,
        headingCount,
        busyCount,
        text.slice(0, 240),
      ].join("|"),
    };
  };

  while (Date.now() - startedAt < timeoutMs) {
    const signature = getSignature();
    const hasUsefulContent =
      signature.isReadyStateSettled &&
      signature.hasBody &&
      (signature.textLength >= 80 ||
        signature.interactiveCount > 0 ||
        signature.headingCount > 0);

    if (hasUsefulContent && signature.value === lastSignature) {
      if (!stableSince) stableSince = Date.now();
      if (Date.now() - stableSince >= stableMs) return signature;
    } else {
      lastSignature = signature.value;
      stableSince = 0;
    }

    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }

  return getSignature();
}

function collectPageSnapshotForGuide() {
  const MAX_TEXT_LENGTH = 600;
  const pageUrl = location.href;
  const interactiveSelector =
    "a[href],button,input,select,textarea,summary,[role],[tabindex]:not([tabindex='-1']),[contenteditable='true']";
  const textBlockSelector =
    "h1,h2,h3,h4,h5,h6,p,li,blockquote,figcaption,caption,label,legend,dt,dd,th,td,[role='heading'],[aria-label]";

  return {
    schemaVersion: "0.1.0",
    collectedAt: new Date().toISOString(),
    page: {
      url: pageUrl,
      origin: location.origin,
      title: document.title,
      language: document.documentElement.lang || null,
      canonicalUrl:
        document.querySelector("link[rel='canonical']")?.href || null,
      metaDescription:
        document
          .querySelector(
            "meta[name='description'], meta[property='description']",
          )
          ?.getAttribute("content") || null,
    },
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
      scrollX: window.scrollX,
      scrollY: window.scrollY,
      documentWidth: document.documentElement.scrollWidth,
      documentHeight: document.documentElement.scrollHeight,
    },
    content: {
      landmarks: Array.from(
        document.querySelectorAll(
          "header,nav,main,aside,footer,section,article,form,[role='banner'],[role='navigation'],[role='main'],[role='complementary'],[role='contentinfo'],[role='search'],[role='region']",
        ),
      )
        .filter((element) => isVisible(element) && !isBridgeElement(element))
        .slice(0, 120)
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: getRole(element),
          label: getAccessibleName(element),
          textPreview: truncate(
            element.innerText || element.textContent || "",
            220,
          ),
          selector: getCssPath(element),
          bounds: getBounds(element),
        })),
      headings: Array.from(
        document.querySelectorAll("h1,h2,h3,h4,h5,h6,[role='heading']"),
      )
        .filter((element) => isVisible(element) && !isBridgeElement(element))
        .slice(0, 120)
        .map((element) => ({
          level: getHeadingLevel(element),
          text: truncate(getElementText(element), MAX_TEXT_LENGTH),
          selector: getCssPath(element),
          bounds: getBounds(element),
        })),
      textBlocks: Array.from(document.querySelectorAll(textBlockSelector))
        .filter((element) => isVisible(element) && !isBridgeElement(element))
        .map((element) => ({
          tag: element.tagName.toLowerCase(),
          role: getRole(element),
          text: truncate(
            getElementText(element) || getAccessibleName(element),
            MAX_TEXT_LENGTH,
          ),
          selector: getCssPath(element),
          bounds: getBounds(element),
          importance: inferImportance(element),
        }))
        .filter((item) => item.text)
        .slice(0, 300),
      interactiveElements: Array.from(
        document.querySelectorAll(interactiveSelector),
      )
        .filter((element) => isVisible(element) && !isBridgeElement(element))
        .map((element, index) => ({
          snapshotId: `interactive-${index + 1}`,
          tag: element.tagName.toLowerCase(),
          role: getRole(element),
          type:
            element.getAttribute("type") ||
            (element.tagName.toLowerCase() === "input" ? "text" : null),
          name: element.getAttribute("name") || null,
          label: getAccessibleName(element),
          text: truncate(getElementText(element), MAX_TEXT_LENGTH),
          href: element instanceof HTMLAnchorElement ? element.href : null,
          disabled: Boolean(
            element.disabled ||
            element.getAttribute("aria-disabled") === "true",
          ),
          required: Boolean(
            element.required ||
            element.getAttribute("aria-required") === "true",
          ),
          checked: ["checkbox", "radio"].includes(element.getAttribute("type"))
            ? Boolean(element.checked)
            : null,
          expanded: element.getAttribute("aria-expanded"),
          hasPopup: element.getAttribute("aria-haspopup"),
          controls: element.getAttribute("aria-controls"),
          placeholder: element.matches("input,select,textarea")
            ? element.getAttribute("placeholder")
            : null,
          selector: getCssPath(element),
          bounds: getBounds(element),
        }))
        .slice(0, 250),
      forms: Array.from(document.forms)
        .filter((form) => !isBridgeElement(form))
        .slice(0, 20)
        .map((form, index) => ({
          snapshotId: `form-${index + 1}`,
          label: getAccessibleName(form),
          selector: getCssPath(form),
          method: (form.getAttribute("method") || "get").toLowerCase(),
          actionOrigin: safeOrigin(form.action),
          bounds: getBounds(form),
          fields: Array.from(
            form.querySelectorAll("input, select, textarea, button"),
          )
            .filter((field) => !isBridgeElement(field))
            .map((field, fieldIndex) => ({
              snapshotId: `form-${index + 1}-field-${fieldIndex + 1}`,
              tag: field.tagName.toLowerCase(),
              type:
                field.getAttribute("type") ||
                (field.tagName.toLowerCase() === "input" ? "text" : null),
              name: field.getAttribute("name") || null,
              label: getAccessibleName(field),
              placeholder: field.getAttribute("placeholder") || null,
              required: Boolean(
                field.required ||
                field.getAttribute("aria-required") === "true",
              ),
              disabled: Boolean(
                field.disabled ||
                field.getAttribute("aria-disabled") === "true",
              ),
              readonly: Boolean(field.readOnly),
              valueIncluded: false,
              selector: getCssPath(field),
              bounds: getBounds(field),
            })),
        })),
      links: Array.from(document.links)
        .filter((link) => isVisible(link) && !isBridgeElement(link))
        .map((link) => ({
          text: truncate(
            getElementText(link) || getAccessibleName(link),
            MAX_TEXT_LENGTH,
          ),
          href: link.href,
          sameOrigin: safeOrigin(link.href) === location.origin,
          selector: getCssPath(link),
          bounds: getBounds(link),
        }))
        .filter((link) => link.text || link.href)
        .slice(0, 250),
    },
  };

  function getAccessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return truncate(ariaLabel, MAX_TEXT_LENGTH);
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id))
        .filter(Boolean)
        .map(getElementText)
        .join(" ");
      if (text) return truncate(text, MAX_TEXT_LENGTH);
    }
    if (element.id) {
      const label = document.querySelector(
        `label[for="${cssEscape(element.id)}"]`,
      );
      if (label) return truncate(getElementText(label), MAX_TEXT_LENGTH);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel)
      return truncate(getElementText(wrappingLabel), MAX_TEXT_LENGTH);
    return (
      truncate(
        element.getAttribute("title") || element.getAttribute("alt") || "",
        MAX_TEXT_LENGTH,
      ) || null
    );
  }

  function getElementText(element) {
    return normalizeText(element?.innerText || element?.textContent || "");
  }

  function getRole(element) {
    const tag = element.tagName.toLowerCase();
    return (
      element.getAttribute("role") ||
      {
        a: "link",
        button: "button",
        nav: "navigation",
        main: "main",
        header: "banner",
        footer: "contentinfo",
        aside: "complementary",
        form: "form",
        select: "combobox",
        textarea: "textbox",
      }[tag] ||
      (/^h[1-6]$/.test(tag) ? "heading" : tag === "input" ? "textbox" : null)
    );
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
    if (
      tag === "h2" ||
      tag === "h3" ||
      element.getAttribute("role") === "heading"
    )
      return "sectionHeading";
    if (element.closest("nav")) return "navigation";
    if (element.closest("main")) return "mainContent";
    if (element.closest("footer")) return "footer";
    return "content";
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function isBridgeElement(element) {
    return Boolean(
      element?.closest?.(
        "#bridge-guided-task-root,#bridge-guided-task-highlight,#bridge-guided-task-style",
      ),
    );
  }

  function getBounds(element) {
    const rect = element.getBoundingClientRect();
    return {
      x: round(rect.x),
      y: round(rect.y),
      width: round(rect.width),
      height: round(rect.height),
      inViewport:
        rect.bottom >= 0 &&
        rect.right >= 0 &&
        rect.top <= window.innerHeight &&
        rect.left <= window.innerWidth,
    };
  }

  function getCssPath(element) {
    if (!element || element.nodeType !== Node.ELEMENT_NODE) return null;
    if (element.id) return `#${cssEscape(element.id)}`;
    const parts = [];
    let current = element;
    while (
      current &&
      current.nodeType === Node.ELEMENT_NODE &&
      current !== document.documentElement
    ) {
      let part = current.tagName.toLowerCase();
      const classNames = Array.from(current.classList).slice(0, 2);
      if (classNames.length) part += `.${classNames.map(cssEscape).join(".")}`;
      const parent = current.parentElement;
      if (parent) {
        const sameTagSiblings = Array.from(parent.children).filter(
          (child) => child.tagName === current.tagName,
        );
        if (sameTagSiblings.length > 1)
          part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
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
    return String(text || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function truncate(text, maxLength) {
    const normalized = normalizeText(text);
    return normalized.length <= maxLength
      ? normalized
      : `${normalized.slice(0, maxLength - 1)}...`;
  }

  function round(value) {
    return Math.round(value * 100) / 100;
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

function removeGuidedTaskOverlay() {
  const ROOT_ID = "bridge-guided-task-root";
  const HIGHLIGHT_ID = "bridge-guided-task-highlight";
  const ACTIVE_CLASS = "bridge-guided-task-active-target";
  if (typeof window.__bridgeGuidedTaskCleanup === "function")
    window.__bridgeGuidedTaskCleanup();
  document.getElementById(ROOT_ID)?.remove();
  document.getElementById(HIGHLIGHT_ID)?.remove();
  document
    .querySelectorAll(`.${ACTIVE_CLASS}`)
    .forEach((element) => element.classList.remove(ACTIVE_CLASS));
}

function installGuidedTaskOverlay(plan, options = {}) {
  const ROOT_ID = "bridge-guided-task-root";
  const HIGHLIGHT_ID = "bridge-guided-task-highlight";
  const STYLE_ID = "bridge-guided-task-style";
  const ACTIVE_CLASS = "bridge-guided-task-active-target";
  const TARGET_MISSING_DEBOUNCE_MS = 500;
  const RENDER_COOLDOWN_MS = 1000;
  let currentIndex = Math.max(
    0,
    Math.min(options.currentStepIndex || 0, plan.steps.length),
  );
  let currentTarget = null;
  let riskAccepted = false;
  let pageStateTimer = null;
  let mutationObserver = null;
  let pendingCompletedProgress = null;
  let pendingCompletedProgressTimer = null;
  let pendingPointerCompletion = null;
  let pendingPointerCompletionTimer = null;
  let ignorePageStateChangesUntil = Date.now() + RENDER_COOLDOWN_MS;

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
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onPageClick, true);
  document.addEventListener("input", onInput, true);
  document.addEventListener("change", onInput, true);
  installPageStateObserver();
  renderStep(options.message || "");

  function renderStep(message = "", renderOptions = {}) {
    const step = plan.steps[currentIndex];
    if (!step) return renderFinished(renderOptions);
    clearTarget();
    ignorePageStateChangesUntil = Date.now() + RENDER_COOLDOWN_MS;
    riskAccepted = step.risk !== "high";
    currentTarget = resolveTarget(step.target);
    if (currentTarget) {
      currentTarget.classList.add(ACTIVE_CLASS);
      currentTarget.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "center",
      });
    }
    root.innerHTML = panelHtml(step, message);
    bindButtons();
    setTimeout(positionOverlay, 250);
    if (!renderOptions.skipProgressNotify) notifyProgress();
    if (!currentTarget && renderOptions.refreshIfTargetMissing) {
      requestModelRefresh("next step target missing");
    }
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
        ${previewHtml()}
        <div class="bridge-guide-progress">Step ${currentIndex + 1} of ${plan.steps.length}</div>
        <div class="bridge-guide-actions">
          ${isHighRisk ? `<button type="button" data-bridge-action="accept-risk">Continue</button>` : `<button type="button" data-bridge-action="next">Next</button>`}
          <button type="button" data-bridge-action="end">End</button>
        </div>
      </section>
    `;
  }

  function previewHtml() {
    const preview = plan.steps[currentIndex + 1];
    if (!preview) return "";
    return `<div class="bridge-guide-preview"><span>Next</span><strong>${escapeHtml(preview.title)}</strong></div>`;
  }

  function bindButtons() {
    root.querySelectorAll("[data-bridge-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.bridgeAction;
        if (action === "next")
          goTo(currentIndex + 1, plan.steps[currentIndex]?.title, {
            refreshIfTargetMissing: true,
            completionMode: "manual",
          });
        if (action === "continue")
          requestModelRefresh("user requested next step");
        if (action === "accept-risk") {
          riskAccepted = true;
          root.innerHTML = panelHtml(
            plan.steps[currentIndex],
            "Risk gate acknowledged. Complete the action on the original page when ready.",
          );
          bindButtons();
          positionOverlay();
        }
        if (action === "end") endGuide(true);
      });
    });
  }

  function goTo(index, completedStep = "", goToOptions = {}) {
    clearPendingPointerCompletion();
    const previousStep = completedStep ? plan.steps[currentIndex] : null;
    const completedStepRecord = previousStep
      ? createCompletedStepRecord(
          previousStep,
          goToOptions.completionMode || "auto",
        )
      : null;
    currentIndex = Math.max(0, Math.min(index, plan.steps.length));
    notifyProgress(completedStep, completedStepRecord);
    if (completedStepRecord)
      rememberCompletedProgressForRefresh(completedStep, completedStepRecord);
    renderStep("", { ...goToOptions, skipProgressNotify: true });
  }

  function onPointerDown(event) {
    if (eventHitsCurrentTarget(event)) maybeComplete("pointerdown");
  }

  function onPageClick(event) {
    if (eventHitsCurrentTarget(event)) maybeComplete("click");
  }

  function onInput(event) {
    if (eventHitsCurrentTarget(event))
      maybeComplete("inputChanged", event.target);
  }

  function maybeComplete(eventType, eventTarget = null) {
    const step = plan.steps[currentIndex];
    if (!step || (step.risk === "high" && !riskAccepted)) return;
    const completion = step.completion || { type: "manual" };
    if (completion.type === "click" && eventType === "pointerdown") {
      completeClickBeforeNavigation(step);
      return;
    }
    if (completion.type === "click" && eventType === "click") {
      if (pendingPointerCompletion?.stepIndex === currentIndex) {
        finishPendingPointerCompletion();
      } else {
        goTo(currentIndex + 1, step.title, { completionMode: "auto-click" });
      }
      return;
    }
    if (
      completion.type === "inputChanged" &&
      eventType === "inputChanged" &&
      !isTextEntryElement(eventTarget)
    )
      goTo(currentIndex + 1, step.title, {
        completionMode: "auto-inputChanged",
      });
    if (
      completion.type === "inputValueEquals" &&
      eventTarget &&
      String(eventTarget.value || "").trim() ===
        String(completion.value || "").trim()
    )
      goTo(currentIndex + 1, step.title, {
        completionMode: "auto-inputValueEquals",
      });
    if (completion.type === "checked" && eventTarget?.checked)
      goTo(currentIndex + 1, step.title, { completionMode: "auto-checked" });
  }

  function completeClickBeforeNavigation(step) {
    if (pendingPointerCompletion?.stepIndex === currentIndex) return;
    const nextIndex = Math.max(
      0,
      Math.min(currentIndex + 1, plan.steps.length),
    );
    const completedStepRecord = createCompletedStepRecord(
      step,
      "auto-click-before-navigation",
    );
    pendingPointerCompletion = {
      stepIndex: currentIndex,
      nextIndex,
      completedStep: step.title,
      completedStepRecord,
    };
    notifyProgress(step.title, completedStepRecord, nextIndex);
    rememberCompletedProgressForRefresh(
      step.title,
      completedStepRecord,
      nextIndex,
    );
    clearTimeout(pendingPointerCompletionTimer);
    pendingPointerCompletionTimer = setTimeout(() => {
      finishPendingPointerCompletion();
    }, 1200);
  }

  function finishPendingPointerCompletion() {
    const completion = pendingPointerCompletion;
    if (!completion) return;
    pendingPointerCompletion = null;
    clearTimeout(pendingPointerCompletionTimer);
    pendingPointerCompletionTimer = setTimeout(() => {
      pendingPointerCompletionTimer = null;
      if (currentIndex !== completion.stepIndex) return;
      currentIndex = completion.nextIndex;
      renderStep("", { skipProgressNotify: true });
    }, 0);
  }

  function clearPendingPointerCompletion() {
    pendingPointerCompletion = null;
    clearTimeout(pendingPointerCompletionTimer);
    pendingPointerCompletionTimer = null;
  }

  function eventHitsCurrentTarget(event) {
    if (!currentTarget) return false;
    if (
      typeof event.composedPath === "function" &&
      event.composedPath().includes(currentTarget)
    )
      return true;
    return currentTarget.contains(event.target);
  }

  function isTextEntryElement(element) {
    if (!(element instanceof Element)) return false;
    if (element.matches("textarea,[contenteditable='true']")) return true;
    if (!element.matches("input")) return false;
    const type = normalize(element.getAttribute("type") || "text");
    return ![
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ].includes(type);
  }

  function createCompletedStepRecord(step, completionMode = "manual") {
    return {
      id: step.id,
      title: step.title,
      instruction: step.instruction,
      target: {
        role: step.target?.role || "",
        label: step.target?.label || "",
        text: step.target?.text || "",
        href: step.target?.href || "",
        selector: step.target?.selector || "",
        name: step.target?.name || "",
        placeholder: step.target?.placeholder || "",
      },
      completionType: step.completion?.type || "",
      completionMode,
      completedAt: new Date().toISOString(),
    };
  }

  function notifyProgress(
    completedStep = "",
    completedStepRecord = null,
    stepIndex = currentIndex,
  ) {
    try {
      chrome.runtime.sendMessage({
        type: "BRIDGE_GUIDE_PROGRESS",
        currentStepIndex: stepIndex,
        completedStep,
        completedStepRecord,
      });
    } catch {}
  }

  function rememberCompletedProgressForRefresh(
    completedStep,
    completedStepRecord,
    stepIndex = currentIndex,
  ) {
    pendingCompletedProgress = {
      completedStep,
      completedStepRecord,
      currentStepIndex: stepIndex,
    };
    clearTimeout(pendingCompletedProgressTimer);
    pendingCompletedProgressTimer = setTimeout(() => {
      pendingCompletedProgress = null;
      pendingCompletedProgressTimer = null;
    }, 5000);
  }

  function installPageStateObserver() {
    if (options.autoRefreshPaused || mutationObserver || !document.body) return;
    mutationObserver = new MutationObserver(() => {
      if (Date.now() < ignorePageStateChangesUntil) return;
      if (isCurrentTargetMissing())
        requestModelRefresh(
          "current target disappeared",
          isCurrentTargetMissing,
        );
    });
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-expanded",
        "aria-hidden",
        "aria-modal",
        "class",
        "hidden",
        "open",
        "role",
        "style",
      ],
    });
  }

  function requestModelRefresh(reason, shouldRefresh = () => true) {
    if (options.autoRefreshPaused) return;
    clearTimeout(pageStateTimer);
    pageStateTimer = setTimeout(() => {
      pageStateTimer = null;
      if (!shouldRefresh()) return;
      const completedProgress = pendingCompletedProgress;
      pendingCompletedProgress = null;
      clearTimeout(pendingCompletedProgressTimer);
      pendingCompletedProgressTimer = null;
      try {
        chrome.runtime.sendMessage({
          type: "BRIDGE_PAGE_STATE_CHANGED",
          reason,
          completedStep: completedProgress?.completedStep || "",
          completedStepRecord: completedProgress?.completedStepRecord || null,
          currentStepIndex: currentIndex,
        });
      } catch {}
    }, TARGET_MISSING_DEBOUNCE_MS);
  }

  function isCurrentTargetMissing() {
    return Boolean(
      currentTarget &&
      (!document.documentElement.contains(currentTarget) ||
        !isVisible(currentTarget)),
    );
  }

  function isBridgeElement(element) {
    return Boolean(
      element?.closest?.(`#${ROOT_ID},#${HIGHLIGHT_ID},#${STYLE_ID}`),
    );
  }

  function resolveTarget(target) {
    const bySelector = findBySelector(target.selector);
    if (bySelector) return bySelector;
    const candidates = Array.from(
      document.querySelectorAll(
        "a[href],button,input,select,textarea,summary,[role],[tabindex]:not([tabindex='-1']),h1,h2,h3,h4,h5,h6,p,li,label",
      ),
    ).filter(isVisible);
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
    if (target.label && label && includesEither(label, target.label))
      score += 5;
    if (target.text && text && includesEither(text, target.text)) score += 5;
    if (
      target.name &&
      normalize(element.getAttribute("name")) === normalize(target.name)
    )
      score += 4;
    if (
      target.placeholder &&
      includesEither(element.getAttribute("placeholder"), target.placeholder)
    )
      score += 4;
    if (
      target.href &&
      element instanceof HTMLAnchorElement &&
      element.href === target.href
    )
      score += 5;
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
    const panelRect = panel.getBoundingClientRect();
    const panelWidth = panelRect.width || Math.min(360, window.innerWidth - 32);
    const panelHeight = panelRect.height || panel.offsetHeight;
    const placement = choosePanelPlacement(rect, panelWidth, panelHeight);
    panel.style.left = `${placement.left}px`;
    panel.style.top = `${placement.top}px`;
  }

  function choosePanelPlacement(targetRect, panelWidth, panelHeight) {
    const gap = 16;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const maxLeft = Math.max(gap, viewportWidth - panelWidth - gap);
    const maxTop = Math.max(gap, viewportHeight - panelHeight - gap);
    const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
    const targetBox = {
      left: targetRect.left - 8,
      right: targetRect.right + 8,
      top: targetRect.top - 8,
      bottom: targetRect.bottom + 8,
    };
    const candidates = [
      {
        left: clamp(targetRect.left, gap, maxLeft),
        top: targetRect.bottom + gap,
      },
      {
        left: clamp(targetRect.left, gap, maxLeft),
        top: targetRect.top - panelHeight - gap,
      },
      { left: targetRect.right + gap, top: clamp(targetRect.top, gap, maxTop) },
      {
        left: targetRect.left - panelWidth - gap,
        top: clamp(targetRect.top, gap, maxTop),
      },
    ];
    const valid = candidates.find(
      (candidate) =>
        candidate.left >= gap &&
        candidate.top >= gap &&
        candidate.left + panelWidth <= viewportWidth - gap &&
        candidate.top + panelHeight <= viewportHeight - gap &&
        !rectsOverlap(candidate, panelWidth, panelHeight, targetBox),
    );
    if (valid) return valid;

    const corners = [
      { left: gap, top: gap },
      { left: maxLeft, top: gap },
      { left: gap, top: maxTop },
      { left: maxLeft, top: maxTop },
    ];
    const targetCenterX = targetRect.left + targetRect.width / 2;
    const targetCenterY = targetRect.top + targetRect.height / 2;
    return corners
      .map((candidate) => ({
        ...candidate,
        distance: Math.hypot(
          candidate.left + panelWidth / 2 - targetCenterX,
          candidate.top + panelHeight / 2 - targetCenterY,
        ),
        overlaps: rectsOverlap(candidate, panelWidth, panelHeight, targetBox),
      }))
      .sort(
        (left, right) =>
          Number(left.overlaps) - Number(right.overlaps) ||
          right.distance - left.distance,
      )[0];
  }

  function rectsOverlap(rect, width, height, targetBox) {
    return (
      rect.left < targetBox.right &&
      rect.left + width > targetBox.left &&
      rect.top < targetBox.bottom &&
      rect.top + height > targetBox.top
    );
  }

  function renderFinished(renderOptions = {}) {
    clearTarget();
    highlight.style.display = "none";
    currentIndex = plan.steps.length;
    if (!renderOptions.skipProgressNotify) notifyProgress();
    root.innerHTML = `<section class="bridge-guide-panel"><div class="bridge-guide-kicker">Guided Task Mode</div><h2>Need another step?</h2><p class="bridge-guide-instruction">The current generated guidance window is finished. You decide whether to ask for the next step or end the guide.</p><div class="bridge-guide-actions"><button type="button" data-bridge-action="continue">Next step</button><button type="button" data-bridge-action="end">End</button></div></section>`;
    bindButtons();
    positionOverlay();
  }

  function clearTarget() {
    if (currentTarget) currentTarget.classList.remove(ACTIVE_CLASS);
    currentTarget = null;
  }

  function endGuide(notify = false) {
    clearTarget();
    clearTimeout(pageStateTimer);
    clearTimeout(pendingCompletedProgressTimer);
    clearPendingPointerCompletion();
    mutationObserver?.disconnect();
    mutationObserver = null;
    window.removeEventListener("resize", positionOverlay);
    window.removeEventListener("scroll", positionOverlay, true);
    document.removeEventListener("pointerdown", onPointerDown, true);
    document.removeEventListener("click", onPageClick, true);
    document.removeEventListener("input", onInput, true);
    document.removeEventListener("change", onInput, true);
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    if (window.__bridgeGuidedTaskCleanup === endGuide)
      window.__bridgeGuidedTaskCleanup = null;
    if (notify) {
      try {
        chrome.runtime.sendMessage({ type: "BRIDGE_END_GUIDE" });
      } catch {}
    }
  }

  function cleanupExistingGuide() {
    if (typeof window.__bridgeGuidedTaskCleanup === "function")
      window.__bridgeGuidedTaskCleanup();
    document.getElementById(ROOT_ID)?.remove();
    document.getElementById(HIGHLIGHT_ID)?.remove();
    document
      .querySelectorAll(`.${ACTIVE_CLASS}`)
      .forEach((element) => element.classList.remove(ACTIVE_CLASS));
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
      .bridge-guide-preview{display:grid;gap:2px;margin:10px 0;border:1px dashed #c8d8ea;border-radius:6px;background:#f7fbff;color:#3e4c5d;padding:8px}
      .bridge-guide-preview span{font-size:11px;font-weight:800;text-transform:uppercase;color:#5d6978}
      .bridge-guide-preview strong{font-size:13px}
      .bridge-guide-actions{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;margin-top:12px}
      .bridge-guide-actions button{min-height:34px;border:1px solid #1769aa;border-radius:6px;background:#1769aa;color:#fff;cursor:pointer;font:inherit;font-size:12px}
      .bridge-guide-actions button:disabled{border-color:#d9dee7;background:#e6e9ef;color:#8792a1;cursor:not-allowed}
    `;
    document.documentElement.append(style);
  }

  function isVisible(element) {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      Number(style.opacity) !== 0 &&
      rect.width > 0 &&
      rect.height > 0
    );
  }

  function getAccessibleName(element) {
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;
    if (element.id) {
      const label = document.querySelector(
        `label[for="${cssEscape(element.id)}"]`,
      );
      if (label) return getElementText(label);
    }
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) return getElementText(wrappingLabel);
    return element.getAttribute("title") || element.getAttribute("alt") || "";
  }

  function getRole(element) {
    const tag = element.tagName.toLowerCase();
    return (
      element.getAttribute("role") ||
      {
        a: "link",
        button: "button",
        input: "textbox",
        select: "combobox",
        textarea: "textbox",
      }[tag] ||
      (/^h[1-6]$/.test(tag) ? "heading" : "")
    );
  }

  function getElementText(element) {
    return String(element?.innerText || element?.textContent || "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function includesEither(left, right) {
    const a = normalize(left);
    const b = normalize(right);
    return Boolean(a && b && (a.includes(b) || b.includes(a)));
  }

  function normalize(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  function escapeHtml(value) {
    return String(value || "").replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#039;",
        })[char],
    );
  }

  function cssEscape(value) {
    if (window.CSS?.escape) return CSS.escape(value);
    return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
  }
}

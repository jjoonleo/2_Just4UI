import {
  assertNoFormValues,
  redactPlanningPayloadUrls
} from "../domain/guidance-contract";

type ClarificationHistoryItem = {
  question?: unknown;
  answer?: unknown;
};

type BackendProviderPlanRequest = {
  backendBaseUrl: string;
  mode: string;
  taskRequest: string;
  planningPayload: unknown;
  previousSession: unknown;
  clarificationHistory?: ClarificationHistoryItem[];
  fetchImpl?: typeof fetch;
};

export async function createBackendProviderPlan({
  backendBaseUrl,
  mode,
  taskRequest,
  planningPayload,
  previousSession,
  clarificationHistory = [],
  fetchImpl = fetch
}: BackendProviderPlanRequest): Promise<unknown> {
  const endpoint = `${normalizeBackendBaseUrl(backendBaseUrl)}/guidance-plan`;
  const safePlanningPayload = sanitizePlanningPayload(planningPayload);
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contractVersion: 1,
      mode,
      taskRequest,
      planningPayload: safePlanningPayload,
      previousSession,
      clarificationHistory: compactClarificationHistory(clarificationHistory)
    })
  }).catch((error) => {
    throw new Error(
      `Backend Proxy request failed before a response: ${errorMessage(error)}`
    );
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      responseErrorMessage(data, `Backend Proxy request failed with HTTP ${response.status}.`)
    );
  }
  return data;
}

export function sanitizePlanningPayload<T>(planningPayload: T): T {
  assertNoFormValues(planningPayload);
  return redactPlanningPayloadUrls(planningPayload);
}

export function normalizeBackendBaseUrl(baseUrl: unknown): string {
  const trimmed = String(baseUrl || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("Backend Proxy URL is missing.");
  return trimmed;
}

function responseErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function compactClarificationHistory(history: ClarificationHistoryItem[]): Array<{
  question?: string;
  answer?: string;
}> {
  return (Array.isArray(history) ? history : []).slice(-6).map((item) => {
    const question = stringOrNull(item?.question);
    const answer = stringOrNull(item?.answer);
    return compactObject({
      ...(question ? { question } : {}),
      ...(answer ? { answer } : {})
    });
  });
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => {
      if (entry == null || entry === "") return false;
      if (Array.isArray(entry) && entry.length === 0) return false;
      return true;
    })
  ) as Partial<T>;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

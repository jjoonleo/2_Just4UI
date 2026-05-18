import {
  assertNoFormValues,
  redactPlanningPayloadUrls
} from "../domain/guidance-contract";
import type { PlanProviderOptions, PlanProviderRequest } from "./provider";

export async function createBackendProviderPlan(
  {
    mode,
    backendBaseUrl,
    taskRequest,
    planningPayload,
    previousSession,
    clarificationHistory = []
  }: PlanProviderRequest,
  { fetchImpl = fetch }: PlanProviderOptions = {}
): Promise<unknown> {
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

export function compactClarificationHistory(
  history: PlanProviderRequest["clarificationHistory"]
): Array<{ question: string | null; answer: string | null }> {
  return (Array.isArray(history) ? history : []).slice(-6).map((item) => ({
    question: stringOrNull(item?.question),
    answer: stringOrNull(item?.answer)
  }));
}

function responseErrorMessage(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data) {
    const error = (data as { error?: unknown }).error;
    if (typeof error === "string" && error.trim()) return error;
  }
  return fallback;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export interface PlanProviderRequest {
  mode: string;
  backendBaseUrl: string;
  taskRequest: string;
  planningPayload: unknown;
  previousSession: unknown;
  clarificationHistory?: Array<{
    question?: string | null;
    answer?: string | null;
  }>;
}

export interface PlanProviderOptions {
  fetchImpl?: typeof fetch;
}

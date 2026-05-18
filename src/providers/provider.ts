import { BACKEND_PROVIDER_ID, normalizeProviderId } from "../shared/provider-registry";
import { createBackendProviderPlan } from "./backend-provider";

type ProviderPlanRequest = {
  provider: unknown;
  backendBaseUrl: string;
  mode: string;
  taskRequest: string;
  planningPayload: unknown;
  previousSession: unknown;
  clarificationHistory?: Array<{ question?: unknown; answer?: unknown }>;
  fetchImpl?: typeof fetch;
};

export async function createProviderPlan(request: ProviderPlanRequest): Promise<unknown> {
  const provider = normalizeProviderId(request.provider);
  if (provider === BACKEND_PROVIDER_ID) {
    return createBackendProviderPlan(request);
  }
  throw new Error("Only Backend Proxy is supported.");
}

import { BRIDGE_STORAGE_KEYS } from "../shared/storage-keys";

export const BACKEND_PROVIDER_ID = "backend";

export type ProviderId = typeof BACKEND_PROVIDER_ID;
export type ProviderCredentialRequirement = "backendBaseUrl";

export interface ProviderRegistryEntry {
  id: ProviderId;
  displayLabel: string;
  settingsLabel: string;
  defaultModel: string;
  defaultBaseUrl: string;
  backendBaseUrlStorageKey: string;
  credentialRequirement: ProviderCredentialRequirement;
}

export const PROVIDER_DEPRECATED_STORAGE_KEYS = [
  "bridgeGeminiApiKey",
  "bridgeGeminiModel",
  "bridgeOpenAiApiKey",
  "bridgeOpenAiModel"
] as const;

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderRegistryEntry> = {
  backend: {
    id: BACKEND_PROVIDER_ID,
    displayLabel: "Backend Proxy",
    settingsLabel: "Backend URL",
    defaultModel: "backend-proxy",
    defaultBaseUrl: "http://localhost:8787",
    backendBaseUrlStorageKey: BRIDGE_STORAGE_KEYS.BACKEND_BASE_URL,
    credentialRequirement: "backendBaseUrl"
  }
} as const;

export function normalizeProviderId(provider: unknown): ProviderId {
  return BACKEND_PROVIDER_ID;
}

export function getProviderConfig(provider: unknown): ProviderRegistryEntry {
  return PROVIDER_REGISTRY[normalizeProviderId(provider)];
}

export function listProviderConfigs(): ProviderRegistryEntry[] {
  return Object.values(PROVIDER_REGISTRY);
}

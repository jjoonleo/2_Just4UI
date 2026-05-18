import { BRIDGE_STORAGE_KEYS } from "./storage-keys";

export const BACKEND_PROVIDER_ID = "backend" as const;

export type ProviderId = typeof BACKEND_PROVIDER_ID;
export type ProviderCredentialRequirement = "backendBaseUrl";

export type ProviderConfig = {
  readonly id: ProviderId;
  readonly displayLabel: string;
  readonly backendUrlLabel: string;
  readonly backendUrlPlaceholder: string;
  readonly defaultModel: string;
  readonly defaultBaseUrl: string;
  readonly modelProviderStorageKey: typeof BRIDGE_STORAGE_KEYS.MODEL_PROVIDER;
  readonly backendBaseUrlStorageKey: typeof BRIDGE_STORAGE_KEYS.BACKEND_BASE_URL;
  readonly credentialRequirement: ProviderCredentialRequirement;
};

export const PROVIDER_REGISTRY = {
  [BACKEND_PROVIDER_ID]: {
    id: BACKEND_PROVIDER_ID,
    displayLabel: "Backend Proxy",
    backendUrlLabel: "Backend URL",
    backendUrlPlaceholder: "http://localhost:8787",
    defaultModel: "backend-proxy",
    defaultBaseUrl: "http://localhost:8787",
    modelProviderStorageKey: BRIDGE_STORAGE_KEYS.MODEL_PROVIDER,
    backendBaseUrlStorageKey: BRIDGE_STORAGE_KEYS.BACKEND_BASE_URL,
    credentialRequirement: "backendBaseUrl"
  }
} as const satisfies Record<ProviderId, ProviderConfig>;

export function normalizeProviderId(provider: unknown): ProviderId {
  return provider === BACKEND_PROVIDER_ID ? BACKEND_PROVIDER_ID : BACKEND_PROVIDER_ID;
}

export function getProviderConfig(provider: unknown): ProviderConfig {
  return PROVIDER_REGISTRY[normalizeProviderId(provider)];
}

export const BRIDGE_STORAGE_KEYS = {
  GUIDANCE_SESSIONS: "bridgeGuidanceSessions",
  GUIDANCE_ACTIVITY: "bridgeGuidanceActivity",
  MODEL_PROVIDER: "bridgeModelProvider",
  BACKEND_BASE_URL: "bridgeBackendBaseUrl"
} as const;

export type BridgeStorageKey =
  (typeof BRIDGE_STORAGE_KEYS)[keyof typeof BRIDGE_STORAGE_KEYS];

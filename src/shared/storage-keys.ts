export const BRIDGE_STORAGE_KEYS = {
  GUIDANCE_SESSIONS: "bridgeGuidanceSessions",
  GUIDANCE_ACTIVITY: "bridgeGuidanceActivity",
  MODEL_PROVIDER: "bridgeModelProvider",
  BACKEND_BASE_URL: "bridgeBackendBaseUrl",
  GEMINI_API_KEY: "bridgeGeminiApiKey",
  GEMINI_MODEL: "bridgeGeminiModel",
  OPENAI_API_KEY: "bridgeOpenAiApiKey",
  OPENAI_MODEL: "bridgeOpenAiModel"
} as const;

export type BridgeStorageKey =
  (typeof BRIDGE_STORAGE_KEYS)[keyof typeof BRIDGE_STORAGE_KEYS];

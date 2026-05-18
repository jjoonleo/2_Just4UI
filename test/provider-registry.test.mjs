import assert from "node:assert/strict";
import test from "node:test";

import {
  getProviderConfig,
  listProviderConfigs,
  normalizeProviderId,
  PROVIDER_DEPRECATED_STORAGE_KEYS
} from "../dist/providers/provider-registry.mjs";

test("provider registry centralizes Backend Proxy metadata", () => {
  const [provider] = listProviderConfigs();

  assert.equal(provider.id, "backend");
  assert.equal(provider.displayLabel, "Backend Proxy");
  assert.equal(provider.settingsLabel, "Backend URL");
  assert.equal(provider.defaultModel, "backend-proxy");
  assert.equal(provider.defaultBaseUrl, "http://localhost:8787");
  assert.equal(provider.backendBaseUrlStorageKey, "bridgeBackendBaseUrl");
  assert.equal(provider.credentialRequirement, "backendBaseUrl");
});

test("provider registry normalizes unknown and legacy direct providers to Backend Proxy", () => {
  assert.equal(normalizeProviderId("backend"), "backend");
  assert.equal(normalizeProviderId("gemini"), "backend");
  assert.equal(normalizeProviderId("openai"), "backend");
  assert.equal(normalizeProviderId("unknown"), "backend");
  assert.equal(getProviderConfig("gemini").displayLabel, "Backend Proxy");
  assert.deepEqual([...PROVIDER_DEPRECATED_STORAGE_KEYS], [
    "bridgeGeminiApiKey",
    "bridgeGeminiModel",
    "bridgeOpenAiApiKey",
    "bridgeOpenAiModel"
  ]);
});

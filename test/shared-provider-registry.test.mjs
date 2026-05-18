import assert from "node:assert/strict";
import test from "node:test";

import {
  BACKEND_PROVIDER_ID,
  getProviderConfig,
  normalizeProviderId,
  PROVIDER_REGISTRY
} from "../dist/shared/provider-registry.mjs";

test("provider registry exposes the Backend Proxy provider contract", () => {
  const provider = getProviderConfig("backend");

  assert.equal(BACKEND_PROVIDER_ID, "backend");
  assert.equal(provider.id, "backend");
  assert.equal(provider.displayLabel, "Backend Proxy");
  assert.equal(provider.defaultModel, "backend-proxy");
  assert.equal(provider.defaultBaseUrl, "http://localhost:8787");
  assert.equal(provider.backendBaseUrlStorageKey, "bridgeBackendBaseUrl");
  assert.equal(provider.credentialRequirement, "backendBaseUrl");
  assert.deepEqual(Object.keys(PROVIDER_REGISTRY), ["backend"]);
});

test("provider normalization keeps old provider values on the Backend Proxy path", () => {
  assert.equal(normalizeProviderId("backend"), "backend");
  assert.equal(normalizeProviderId("gemini"), "backend");
  assert.equal(normalizeProviderId("openai"), "backend");
  assert.equal(normalizeProviderId(""), "backend");
  assert.equal(normalizeProviderId(undefined), "backend");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  createBackendProviderPlan,
  normalizeBackendBaseUrl
} from "../dist/providers/backend-provider.mjs";

test("backend provider adapter builds the guidance-plan request", async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: "ready", steps: [] })
    };
  };

  const plan = await createBackendProviderPlan({
    backendBaseUrl: "http://localhost:8787///",
    mode: "refresh",
    taskRequest: "Find the return policy",
    planningPayload: { page: { title: "Help" } },
    previousSession: { currentStepIndex: 1 },
    clarificationHistory: [
      { question: "Old question", answer: "Old answer" },
      { question: "Which item?", answer: "The jacket" }
    ],
    fetchImpl
  });

  assert.deepEqual(plan, { status: "ready", steps: [] });
  assert.equal(calls[0].url, "http://localhost:8787/guidance-plan");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    contractVersion: 1,
    mode: "refresh",
    taskRequest: "Find the return policy",
    planningPayload: { page: { title: "Help" } },
    previousSession: { currentStepIndex: 1 },
    clarificationHistory: [
      { question: "Old question", answer: "Old answer" },
      { question: "Which item?", answer: "The jacket" }
    ]
  });
});

test("backend provider adapter normalizes URLs and formats backend failures", async () => {
  assert.equal(normalizeBackendBaseUrl(" http://localhost:8787/ "), "http://localhost:8787");
  assert.throws(() => normalizeBackendBaseUrl(" "), /Backend Proxy URL is missing/);

  await assert.rejects(
    () =>
      createBackendProviderPlan({
        backendBaseUrl: "http://localhost:8787",
        mode: "initial",
        taskRequest: "Find the return policy",
        planningPayload: {},
        previousSession: null,
        clarificationHistory: [],
        fetchImpl: async () => ({
          ok: false,
          status: 502,
          json: async () => ({ error: "Codex returned invalid JSON." })
        })
      }),
    /Codex returned invalid JSON/
  );

  await assert.rejects(
    () =>
      createBackendProviderPlan({
        backendBaseUrl: "http://localhost:8787",
        mode: "initial",
        taskRequest: "Find the return policy",
        planningPayload: {},
        previousSession: null,
        clarificationHistory: [],
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          json: async () => {
            throw new Error("not json");
          }
        })
      }),
    /Backend Proxy request failed with HTTP 500/
  );

  await assert.rejects(
    () =>
      createBackendProviderPlan({
        backendBaseUrl: "http://localhost:8787",
        mode: "initial",
        taskRequest: "Find the return policy",
        planningPayload: {},
        previousSession: null,
        clarificationHistory: [],
        fetchImpl: async () => {
          throw new Error("connection refused");
        }
      }),
    /Backend Proxy request failed before a response: connection refused/
  );
});

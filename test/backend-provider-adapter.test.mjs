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

test("backend provider adapter redacts Planning Payload URLs before provider calls", async () => {
  const calls = [];

  await createBackendProviderPlan({
    backendBaseUrl: "http://localhost:8787",
    mode: "initial",
    taskRequest: "Find help",
    planningPayload: {
      page: {
        url: "https://example.com/orders?token=secret#receipt",
        canonicalUrl: "https://example.com/orders?session=abc"
      },
      links: [{ href: "https://example.com/help?q=private#top" }],
      interactiveElements: [{ href: "/checkout?cart=secret#pay" }]
    },
    previousSession: null,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "needsClarification", question: "Which order?" })
      };
    }
  });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.planningPayload.page.url, "https://example.com/orders");
  assert.equal(body.planningPayload.page.canonicalUrl, "https://example.com/orders");
  assert.equal(body.planningPayload.links[0].href, "https://example.com/help");
  assert.equal(body.planningPayload.interactiveElements[0].href, "/checkout");
});

test("backend provider adapter rejects likely form values before provider calls", async () => {
  let called = false;

  await assert.rejects(
    () =>
      createBackendProviderPlan({
        backendBaseUrl: "http://localhost:8787",
        mode: "initial",
        taskRequest: "Find help",
        planningPayload: {
          forms: [{ label: "Email", value: "ejun@example.com" }]
        },
        previousSession: null,
        fetchImpl: async () => {
          called = true;
          return {
            ok: true,
            status: 200,
            json: async () => ({})
          };
        }
      }),
    /form values/i
  );

  assert.equal(called, false);
});

test("backend provider adapter allows form metadata without user-entered values", async () => {
  let body = null;

  await createBackendProviderPlan({
    backendBaseUrl: "http://localhost:8787",
    mode: "initial",
    taskRequest: "Find help",
    planningPayload: {
      forms: [{ label: "Email", type: "email", valueIncluded: false }]
    },
    previousSession: null,
    fetchImpl: async (_url, init) => {
      body = JSON.parse(init.body);
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "needsClarification", question: "Which help page?" })
      };
    }
  });

  assert.deepEqual(body.planningPayload.forms, [
    { label: "Email", type: "email", valueIncluded: false }
  ]);
});

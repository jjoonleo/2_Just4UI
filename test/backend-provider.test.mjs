import assert from "node:assert/strict";
import test from "node:test";

import { createBackendProviderPlan } from "../dist/providers/backend-provider.mjs";

test("backend provider adapter owns request construction and response extraction", async () => {
  const calls = [];
  const plan = {
    status: "ready",
    clarifiedTaskRequest: "Find help",
    summary: "Open help.",
    steps: []
  };

  const result = await createBackendProviderPlan(
    {
      mode: "initial",
      backendBaseUrl: "http://localhost:8787/",
      taskRequest: "Find help",
      planningPayload: { page: { title: "Example" } },
      previousSession: null,
      clarificationHistory: Array.from({ length: 7 }, (_, index) => ({
        question: `q${index}`,
        answer: `a${index}`
      }))
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => plan
        };
      }
    }
  );

  assert.equal(result, plan);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "http://localhost:8787/guidance-plan");
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(calls[0].init.headers, { "Content-Type": "application/json" });

  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.contractVersion, 1);
  assert.equal(body.mode, "initial");
  assert.equal(body.taskRequest, "Find help");
  assert.deepEqual(body.planningPayload, { page: { title: "Example" } });
  assert.deepEqual(body.previousSession, null);
  assert.deepEqual(body.clarificationHistory, [
    { question: "q1", answer: "a1" },
    { question: "q2", answer: "a2" },
    { question: "q3", answer: "a3" },
    { question: "q4", answer: "a4" },
    { question: "q5", answer: "a5" },
    { question: "q6", answer: "a6" }
  ]);
});

test("backend provider adapter redacts Planning Payload URLs before provider calls", async () => {
  const calls = [];

  await createBackendProviderPlan(
    {
      mode: "initial",
      backendBaseUrl: "http://localhost:8787",
      taskRequest: "Find help",
      planningPayload: {
        page: {
          url: "https://example.com/orders?token=secret#receipt",
          canonicalUrl: "https://example.com/orders?session=abc"
        },
        links: [{ href: "https://example.com/help?q=private#top" }],
        interactiveElements: [{ href: "/checkout?cart=secret#pay" }]
      },
      previousSession: null
    },
    {
      fetchImpl: async (url, init) => {
        calls.push({ url, init });
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "needsClarification", question: "Which order?" })
        };
      }
    }
  );

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
      createBackendProviderPlan(
        {
          mode: "initial",
          backendBaseUrl: "http://localhost:8787",
          taskRequest: "Find help",
          planningPayload: {
            forms: [{ label: "Email", value: "ejun@example.com" }]
          },
          previousSession: null
        },
        {
          fetchImpl: async () => {
            called = true;
            return {
              ok: true,
              status: 200,
              json: async () => ({})
            };
          }
        }
      ),
    /form values/i
  );

  assert.equal(called, false);
});

test("backend provider adapter allows form metadata without user-entered values", async () => {
  let body = null;

  await createBackendProviderPlan(
    {
      mode: "initial",
      backendBaseUrl: "http://localhost:8787",
      taskRequest: "Find help",
      planningPayload: {
        forms: [{ label: "Email", type: "email", valueIncluded: false }]
      },
      previousSession: null
    },
    {
      fetchImpl: async (_url, init) => {
        body = JSON.parse(init.body);
        return {
          ok: true,
          status: 200,
          json: async () => ({ status: "needsClarification", question: "Which help page?" })
        };
      }
    }
  );

  assert.deepEqual(body.planningPayload.forms, [
    { label: "Email", type: "email", valueIncluded: false }
  ]);
});

test("backend provider adapter formats backend error responses", async () => {
  await assert.rejects(
    () =>
      createBackendProviderPlan(
        {
          mode: "initial",
          backendBaseUrl: "http://localhost:8787",
          taskRequest: "Find help",
          planningPayload: {},
          previousSession: null
        },
        {
          fetchImpl: async () => ({
            ok: false,
            status: 502,
            json: async () => ({ error: "Codex returned invalid JSON." })
          })
        }
      ),
    /Codex returned invalid JSON/
  );
});

test("backend provider adapter does not require live provider calls in tests", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("unexpected live provider call");
  };

  try {
    const result = await createBackendProviderPlan(
      {
        mode: "initial",
        backendBaseUrl: "http://localhost:8787",
        taskRequest: "Find help",
        planningPayload: {},
        previousSession: null
      },
      {
        fetchImpl: async () => ({
          ok: true,
          status: 200,
          json: async () => ({ status: "needsClarification", question: "Which help page?" })
        })
      }
    );

    assert.deepEqual(result, {
      status: "needsClarification",
      question: "Which help page?"
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

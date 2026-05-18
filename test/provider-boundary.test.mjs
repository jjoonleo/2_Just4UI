import assert from "node:assert/strict";
import test from "node:test";

import { createProviderPlan } from "../dist/providers/provider.mjs";

test("provider boundary normalizes stale provider ids onto Backend Proxy", async () => {
  const requests = [];
  const plan = await createProviderPlan({
    provider: "openai",
    backendBaseUrl: "http://localhost:8787",
    mode: "initial",
    taskRequest: "Find the return policy",
    planningPayload: {},
    previousSession: null,
    clarificationHistory: [],
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      return {
        ok: true,
        status: 200,
        json: async () => ({ status: "needsClarification", question: "Which item?" })
      };
    }
  });

  assert.deepEqual(plan, { status: "needsClarification", question: "Which item?" });
  assert.equal(requests[0].url, "http://localhost:8787/guidance-plan");
});

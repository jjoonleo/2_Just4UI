import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoFormValues,
  maxStepsForGuidancePlanMode,
  parseProviderPlan,
  redactPlanningPayloadUrls,
  validateGuidancePlan
} from "../dist/domain/guidance-contract.mjs";

test("planning payload URL redaction preserves page identity while removing query strings and fragments", () => {
  const redacted = redactPlanningPayloadUrls({
    page: {
      url: "https://example.com/orders?token=secret#receipt",
      canonicalUrl: "https://example.com/orders?session=abc"
    },
    links: [{ href: "https://example.com/help?q=private#top" }],
    interactiveElements: [{ href: "/checkout?cart=secret#pay", label: "Checkout" }]
  });

  assert.equal(redacted.page.url, "https://example.com/orders");
  assert.equal(redacted.page.canonicalUrl, "https://example.com/orders");
  assert.equal(redacted.links[0].href, "https://example.com/help");
  assert.equal(redacted.interactiveElements[0].href, "/checkout");
});

test("planning payload validation rejects user-entered form values", () => {
  assert.doesNotThrow(() =>
    assertNoFormValues({
      forms: [{ label: "Email", type: "email", valueIncluded: false }]
    })
  );

  assert.throws(
    () =>
      assertNoFormValues({
        forms: [{ label: "Email", value: "ejun@example.com" }]
      }),
    /form values/i
  );
});

test("provider plan parsing accepts fenced JSON and rejects invalid output", () => {
  assert.deepEqual(parseProviderPlan('```json\\n{"status":"ready"}\\n```'), {
    status: "ready"
  });
  assert.throws(() => parseProviderPlan("not json"), /invalid JSON/i);
});

test("guidance plan validation enforces mode step limits and normalizes steps", () => {
  const plan = validateGuidancePlan(
    {
      status: "ready",
      clarifiedTaskRequest: "Find the return policy",
      summary: "Find the return policy from the help page.",
      assumptions: ["The visible Help link is relevant."],
      steps: [
        {
          title: "Open Help",
          instruction: "Use the Help link.",
          target: { role: "link", text: "Help", href: "/help" },
          risk: "low"
        }
      ]
    },
    "Find the return policy",
    "initial"
  );

  assert.equal(maxStepsForGuidancePlanMode("initial"), 2);
  assert.equal(maxStepsForGuidancePlanMode("refresh"), 8);
  assert.equal(plan.status, "ready");
  assert.equal(plan.steps[0].id, "step-1");
  assert.equal(plan.steps[0].completion.type, "click");
});

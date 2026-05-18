import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoFormValues,
  maxStepsForGuidancePlanMode,
  parseProviderPlan,
  preparePlanningPayloadForProvider,
  redactPlanningPayloadUrls,
  validateGuidancePlan,
  validateGuideOnlyPolicy
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

test("provider planning payload preparation rejects form values before returning a redacted payload", () => {
  const payload = {
    page: {
      url: "https://example.com/orders?token=secret#receipt",
      canonicalUrl: "https://example.com/orders?session=abc"
    },
    links: [{ href: "https://example.com/help?q=private#top" }],
    interactiveElements: [
      { href: "/checkout?cart=secret#pay", label: "Checkout" }
    ],
    forms: [{ label: "Email", type: "email", valueIncluded: false }]
  };

  const prepared = preparePlanningPayloadForProvider(payload);

  assert.notEqual(prepared, payload);
  assert.equal(prepared.page.url, "https://example.com/orders");
  assert.equal(prepared.page.canonicalUrl, "https://example.com/orders");
  assert.equal(prepared.links[0].href, "https://example.com/help");
  assert.equal(prepared.interactiveElements[0].href, "/checkout");
  assert.equal(payload.page.url, "https://example.com/orders?token=secret#receipt");

  assert.throws(
    () =>
      preparePlanningPayloadForProvider({
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

test("Guide-Only policy rejects extension-side page action instructions", () => {
  const actionInstructions = [
    "Bridge will click the checkout button for you.",
    "The extension will type your email into the form.",
    "The guide will submit the form now.",
    "AI will purchase the item for you.",
    "The assistant will delete the selected account.",
    "We will confirm the final step."
  ];

  for (const instruction of actionInstructions) {
    const plan = validateGuidancePlan(
      {
        status: "ready",
        clarifiedTaskRequest: "Buy the item",
        summary: "Guide the user to checkout.",
        assumptions: [],
        steps: [
          {
            title: "Checkout",
            instruction,
            target: { role: "button", text: "Checkout" },
            risk: "high"
          }
        ]
      },
      "Buy the item",
      "initial"
    );

    assert.throws(() => validateGuideOnlyPolicy(plan), /Guide-Only/i);
  }
});

test("Guide-Only policy upgrades high-risk guidance for payment, deletion, and personal information", () => {
  const cases = [
    {
      task: "Pay for this item",
      instruction: "Use the payment button when you are ready.",
      target: { role: "button", text: "Pay now" }
    },
    {
      task: "Delete my account",
      instruction: "Use the Delete account button when you are ready.",
      target: { role: "button", text: "Delete account" }
    },
    {
      task: "Submit my profile",
      instruction: "Use the personal information form submit button.",
      target: { role: "button", text: "Submit personal information" }
    }
  ];

  for (const item of cases) {
    const plan = validateGuidancePlan(
      {
        status: "ready",
        clarifiedTaskRequest: item.task,
        summary: "Guide the user to the sensitive control.",
        assumptions: [],
        steps: [
          {
            title: "Find the sensitive control",
            instruction: item.instruction,
            target: item.target,
            risk: "low"
          }
        ]
      },
      item.task,
      "initial"
    );

    const policySafePlan = validateGuideOnlyPolicy(plan);

    assert.equal(policySafePlan.steps[0].risk, "high");
    assert.equal(plan.steps[0].risk, "low");
  }
});

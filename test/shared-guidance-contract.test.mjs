import assert from "node:assert/strict";
import test from "node:test";

import {
  assertNoFormValues,
  maxStepsForGuidancePlanMode,
  parseProviderPlan,
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

test("Guide-Only policy rejects model output that says the extension performs page actions", () => {
  const plan = validateGuidancePlan(
    {
      status: "ready",
      clarifiedTaskRequest: "Confirm the purchase",
      summary: "Confirm the purchase.",
      steps: [
        {
          title: "Confirm purchase",
          instruction: "The extension will click the Confirm purchase button for you.",
          target: { role: "button", text: "Confirm purchase" },
          risk: "high"
        }
      ]
    },
    "Confirm the purchase",
    "initial"
  );

  assert.throws(() => validateGuideOnlyPolicy(plan), /Guide-Only/i);
});

test("Guide-Only policy upgrades sensitive or destructive steps to high risk", () => {
  const plan = validateGuidancePlan(
    {
      status: "ready",
      clarifiedTaskRequest: "Delete my account",
      summary: "Guide the user to account deletion.",
      steps: [
        {
          title: "Open account deletion",
          instruction: "Use the Delete account button.",
          target: { role: "button", text: "Delete account" },
          risk: "low"
        }
      ]
    },
    "Delete my account",
    "initial"
  );

  const policyChecked = validateGuideOnlyPolicy(plan);

  assert.equal(policyChecked.status, "ready");
  assert.equal(policyChecked.steps[0].risk, "high");
});

test("Guide-Only policy upgrades payment steps to high risk", () => {
  const plan = validateGuidancePlan(
    {
      status: "ready",
      clarifiedTaskRequest: "Pay for my order",
      summary: "Guide the user to payment.",
      steps: [
        {
          title: "Review payment",
          instruction: "Use the Pay now button when you are ready.",
          target: { role: "button", text: "Pay now" },
          risk: "low"
        }
      ]
    },
    "Pay for my order",
    "initial"
  );

  const policyChecked = validateGuideOnlyPolicy(plan);

  assert.equal(policyChecked.status, "ready");
  assert.equal(policyChecked.steps[0].risk, "high");
});

test("Guide-Only policy upgrades personal-information steps to high risk", () => {
  const plan = validateGuidancePlan(
    {
      status: "ready",
      clarifiedTaskRequest: "Update my profile",
      summary: "Guide the user to profile updates.",
      steps: [
        {
          title: "Review contact details",
          instruction: "Use the fields for your home address and phone number.",
          target: { role: "textbox", label: "Home address" },
          risk: "low"
        }
      ]
    },
    "Update my profile",
    "initial"
  );

  const policyChecked = validateGuideOnlyPolicy(plan);

  assert.equal(policyChecked.status, "ready");
  assert.equal(policyChecked.steps[0].risk, "high");
});

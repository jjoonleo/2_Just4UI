import assert from "node:assert/strict";
import test from "node:test";

import { resolvePageTarget } from "../dist/extension/content/target-matching.mjs";

test("target matching resolves current snapshotId before selector fallback", () => {
  const result = resolvePageTarget(
    {
      snapshotId: "interactive-2",
      selector: "#wrong",
      role: "button",
      label: "Add to cart"
    },
    [
      {
        element: "wrong-selector",
        selector: "#wrong",
        role: "button",
        label: "Cancel"
      },
      {
        element: "snapshot-target",
        snapshotId: "interactive-2",
        selector: "#add",
        role: "button",
        label: "Add to cart"
      }
    ]
  );

  assert.equal(result, "snapshot-target");
});

test("target matching treats evidence-mismatched snapshotId as stale and falls back to selector", () => {
  const result = resolvePageTarget(
    {
      snapshotId: "interactive-2",
      selector: "#add",
      role: "button",
      label: "Add to cart"
    },
    [
      {
        element: "stale-snapshot-id",
        snapshotId: "interactive-2",
        selector: "#cancel",
        role: "button",
        label: "Cancel"
      },
      {
        element: "selector-target",
        selector: "#add",
        role: "button",
        label: "Add to cart"
      }
    ]
  );

  assert.equal(result, "selector-target");
});

test("target matching falls back to role and label evidence when snapshotId and selector miss", () => {
  const result = resolvePageTarget(
    {
      snapshotId: "interactive-9",
      selector: "#missing",
      role: "link",
      label: "Return policy"
    },
    [
      {
        element: "help-link",
        selector: "#help",
        role: "link",
        label: "Return policy"
      }
    ]
  );

  assert.equal(result, "help-link");
});

test("target matching returns null when no snapshotId, selector, or semantic evidence matches", () => {
  const result = resolvePageTarget(
    {
      snapshotId: "interactive-9",
      selector: "#missing",
      role: "button",
      label: "Delete account"
    },
    [
      {
        element: "unrelated-link",
        snapshotId: "interactive-1",
        selector: "#help",
        role: "link",
        label: "Help center"
      }
    ]
  );

  assert.equal(result, null);
});

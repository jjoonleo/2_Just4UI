import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const smokeWorkflowDoc = readFileSync(
  new URL("../docs/chrome-cdp-smoke-workflow.md", import.meta.url),
  "utf8"
);
const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

test("Chrome/CDP smoke workflow documents required Bridge checks", () => {
  for (const requiredText of [
    "Load the Unpacked Extension",
    "Open the Side Panel",
    "Missing Backend Behavior",
    "Overlay Rendering",
    "Target Highlight Placement",
    "Navigation And Active-Tab Refresh",
    "Unsupported-Page Pause",
    "Development-Only CDP",
    "Guide-Only Assistance"
  ]) {
    assert.match(smokeWorkflowDoc, new RegExp(requiredText, "i"));
  }
});

test("README links to the Chrome/CDP smoke workflow", () => {
  assert.match(readme, /docs\/chrome-cdp-smoke-workflow\.md/);
});

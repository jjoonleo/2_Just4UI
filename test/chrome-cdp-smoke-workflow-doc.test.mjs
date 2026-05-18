import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflowPath = "docs/chrome-cdp-smoke-workflow.md";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("README links the development-only Chrome/CDP smoke workflow", () => {
  const readme = read("README.md");

  assert.match(readme, new RegExp(workflowPath));
  assert.match(readme, /npm run smoke:chrome/);
});

test("Chrome/CDP smoke workflow documents Bridge development QA boundaries", () => {
  const workflow = read(workflowPath);

  [
    "development-only",
    "Load unpacked",
    "side panel",
    "Backend Proxy",
    "backend URL",
    "missing backend",
    "overlay",
    "target highlight",
    "navigation",
    "active-tab",
    "unsupported page",
    "console errors",
    "must not click",
    "must not type",
    "CDP is not a product runtime dependency",
    "refresh in progress",
    "Pause auto refresh",
    "npm run smoke:chrome",
    "stub backend",
    "local HTTP fixture pages",
    "opt-in",
    "Chrome for Testing",
    "BRIDGE_EXTENSION_ID"
  ].forEach((requiredText) => {
    assert.match(workflow, new RegExp(requiredText, "i"));
  });

  assert.doesNotMatch(workflow, /Gemini Demo|OpenAI Demo|API key/i);
});

test("Chrome smoke runner stays opt-in and outside ordinary tests", () => {
  const packageJson = JSON.parse(read("package.json"));
  const smokeScript = read("scripts/chrome-cdp-smoke.mjs");

  assert.equal(
    packageJson.scripts["smoke:chrome"],
    "npm run build && node scripts/chrome-cdp-smoke.mjs",
  );
  assert.doesNotMatch(packageJson.scripts.test, /smoke:chrome|chrome-cdp-smoke/);
  assert.match(smokeScript, /--load-extension/);
  assert.match(smokeScript, /startStubBackend/);
  assert.match(smokeScript, /chrome:\/\/extensions\//);
  assert.match(smokeScript, /BRIDGE_START_GUIDE/);
});

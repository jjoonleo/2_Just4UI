import assert from "node:assert/strict";
import test from "node:test";

import {
  createSmokePlan,
  formatSmokeReport,
  parseSmokeArgs
} from "../scripts/chrome-smoke.mjs";

test("chrome smoke runner dry-run plan is development-only and uses supported pages", () => {
  const options = parseSmokeArgs(["--dry-run", "--keep-profile"]);
  const plan = createSmokePlan({
    cwd: "/repo",
    options,
    chromePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  });

  assert.equal(plan.dryRun, true);
  assert.equal(plan.developmentOnly, true);
  assert.equal(plan.extensionRoot, "/repo");
  assert.equal(plan.keepProfile, true);
  assert.equal(plan.checks.includes("open-http-fixture-page"), true);
  assert.equal(plan.checks.includes("open-extension-side-panel-page"), true);
  assert.equal(plan.checks.includes("start-guide-through-service-worker"), true);
  assert.equal(plan.checks.includes("verify-overlay-and-highlight"), true);
  assert.equal(plan.checks.includes("verify-navigation-refresh"), true);
  assert.equal(plan.checks.includes("verify-unsupported-page-pause"), true);
  assert.equal(plan.checks.includes("collect-console-errors"), true);
  assert.match(plan.fixtureUrl, /^http:\/\/127\.0\.0\.1:/);
  assert.equal(plan.unsupportedUrl, "chrome://extensions");
});

test("parseSmokeArgs recognizes dry-run from CLI argv", () => {
  assert.deepEqual(parseSmokeArgs(["--dry-run", "--port", "9333"]), {
    chromePath: "",
    cdpUrl: "",
    dryRun: true,
    keepProfile: false,
    remoteDebuggingPort: 9333,
    unsupportedUrl: "chrome://extensions"
  });
});

test("chrome smoke report fails when any smoke check fails or console errors are captured", () => {
  const report = formatSmokeReport({
    ok: false,
    checks: [
      { name: "open-http-fixture-page", ok: true },
      { name: "verify-overlay-and-highlight", ok: false, detail: "Overlay missing" }
    ],
    consoleErrors: [
      { source: "target-page", text: "Uncaught test error" }
    ]
  });

  assert.match(report, /FAILED/);
  assert.match(report, /Overlay missing/);
  assert.match(report, /target-page/);
  assert.match(report, /Uncaught test error/);
});

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Chrome smoke runner lists the required Guided Task Mode checks", () => {
  const output = execFileSync(
    process.execPath,
    ["scripts/smoke-bridge.mjs", "--list-checks"],
    { encoding: "utf8" }
  );
  const checks = JSON.parse(output);

  assert.deepEqual(
    checks.map((check) => check.id),
    [
      "http-test-page",
      "side-panel-flow",
      "missing-backend",
      "overlay-rendering",
      "target-highlight-placement",
      "navigation-refresh",
      "unsupported-page-pause",
      "console-errors"
    ]
  );
});

test("package.json exposes the development-only Chrome smoke command", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

  assert.equal(packageJson.scripts["smoke:chrome"], "node scripts/smoke-bridge.mjs");
});

#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { createServer } from "node:http";
import net from "node:net";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";

const CHECKS = [
  {
    id: "http-test-page",
    description: "Open a regular http test page for Guided Task Mode."
  },
  {
    id: "side-panel-flow",
    description: "Open or verify the Bridge side panel extension page."
  },
  {
    id: "missing-backend",
    description: "Verify a missing Backend Proxy fails without a stale overlay."
  },
  {
    id: "overlay-rendering",
    description: "Verify the guide overlay renders on the target page."
  },
  {
    id: "target-highlight-placement",
    description: "Verify the highlight overlaps the intended Page Target."
  },
  {
    id: "navigation-refresh",
    description: "Verify navigation refresh replaces page-specific guidance."
  },
  {
    id: "unsupported-page-pause",
    description: "Verify unsupported pages pause cleanly without stale overlay."
  },
  {
    id: "console-errors",
    description: "Capture console errors from page, side panel, and service worker."
  }
];

const DEFAULT_CHROME_PATHS = [
  process.env.CHROME_PATH,
  getCachedChromeForTestingPath(),
  "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing"
].filter(Boolean);

main().catch((error) => {
  console.error(`Smoke check failed: ${error.message}`);
  process.exitCode = 1;
});

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.listChecks) {
    console.log(JSON.stringify(CHECKS, null, 2));
    return;
  }

  const repoRoot = path.resolve(options.extensionPath || process.cwd());
  const chromePath = options.chromePath || (await findChromePath(options));
  if (!chromePath) {
    throw new Error(
      "Chrome was not found. Pass --chrome-path=/path/to/Chrome or set CHROME_PATH."
    );
  }

  if (!options.skipBuild) {
    run("npm", ["run", "build"], { cwd: repoRoot });
  }

  const cdpPort = await getFreePort();
  const pagePort = await getFreePort();
  const backendPort = await getFreePort();
  const pageServer = await startPageServer(pagePort);
  const backendServer = await startBackendServer(backendPort);
  const userDataDir = await mkdtemp(path.join(os.tmpdir(), "bridge-smoke-"));
  let chrome = null;
  let cdp = null;
  const consoleErrors = [];

  try {
    chrome = launchChrome({
      chromePath,
      cdpPort,
      userDataDir,
      repoRoot,
      headless: options.headless
    });

    const browserWsUrl = await waitForBrowserWebSocket(cdpPort, options.timeoutMs);
    cdp = await CdpConnection.connect(browserWsUrl);
    await cdp.send("Target.setDiscoverTargets", { discover: true });

    const extensionId = await waitForExtensionId(cdp, options.timeoutMs);
    const pageUrl = `http://127.0.0.1:${pagePort}/index.html`;
    const nextUrl = `http://127.0.0.1:${pagePort}/next.html`;
    const backendUrl = `http://127.0.0.1:${backendPort}`;

    const page = await createAttachedTarget(cdp, pageUrl, "target page");
    await captureConsole(cdp, page, "target page", consoleErrors);
    await page.send("Page.enable");
    await waitForLoad(page);
    await expectPageReady(page);
    mark("http-test-page", "Opened local http test page.");

    const sidePanel = await createAttachedTarget(
      cdp,
      `chrome-extension://${extensionId}/dist/sidepanel.html`,
      "side panel"
    );
    await captureConsole(cdp, sidePanel, "side panel", consoleErrors);
    await sidePanel.send("Page.enable");
    await waitForLoad(sidePanel);
    await expectSidePanelReady(sidePanel);
    mark("side-panel-flow", "Verified Bridge side panel extension page.");

    const serviceWorker = await attachToServiceWorker(cdp, extensionId);
    await captureConsole(cdp, serviceWorker, "service worker", consoleErrors);

    const missingBackendResponse = await startGuideFromExtensionPage(sidePanel, {
      pageUrl,
      backendUrl: "http://127.0.0.1:9",
      taskRequest: "Find the return policy"
    });
    if (missingBackendResponse?.ok) {
      throw new Error("Missing backend unexpectedly started a guide.");
    }
    const missingOverlay = await getOverlayState(page, "#return-details");
    if (missingOverlay.hasOverlay) {
      throw new Error("Missing backend left a stale guide overlay on the page.");
    }
    mark("missing-backend", "Missing backend failed without a stale overlay.");

    const startResponse = await startGuideFromExtensionPage(sidePanel, {
      pageUrl,
      backendUrl,
      taskRequest: "Find the return policy"
    });
    if (!startResponse?.ok) {
      throw new Error(startResponse?.error || "Guide did not start.");
    }

    const overlayState = await waitFor(
      () => getOverlayState(page, "#return-details"),
      (state) =>
        state.hasOverlay &&
        state.hasHighlight &&
        state.highlightOverlapsTarget,
      options.timeoutMs,
      "guide overlay and highlight"
    );
    if (!overlayState.overlayText.includes("Show return details")) {
      throw new Error("Guide overlay did not include the expected step.");
    }
    mark("overlay-rendering", "Guide overlay rendered on the target page.");

    if (!overlayState.highlightOverlapsTarget) {
      throw new Error("Guide highlight does not overlap the intended Page Target.");
    }
    mark("target-highlight-placement", "Highlight overlaps the intended Page Target.");

    await page.send("Page.navigate", { url: nextUrl });
    await waitForLoad(page);
    const refreshedState = await waitFor(
      () => getOverlayState(page, "#next-action"),
      (state) =>
        state.hasOverlay &&
        state.hasHighlight &&
        state.highlightOverlapsTarget &&
        state.overlayText.includes("Next page action"),
      options.timeoutMs,
      "navigation refresh overlay"
    );
    if (!refreshedState.highlightOverlapsTarget) {
      throw new Error("Refreshed highlight does not overlap the next Page Target.");
    }
    mark("navigation-refresh", "Navigation refresh rendered the next page guide.");

    await page.send("Page.navigate", { url: "chrome://extensions" });
    await waitFor(
      () => getDashboard(sidePanel),
      (dashboardResponse) => dashboardResponse?.dashboard?.status === "paused",
      options.timeoutMs,
      "unsupported-page pause"
    );
    mark("unsupported-page-pause", "Unsupported page moved the guide to paused state.");

    const unexpectedConsoleErrors = consoleErrors.filter(
      (entry) => !isExpectedConsoleNoise(entry)
    );
    if (unexpectedConsoleErrors.length) {
      const details = unexpectedConsoleErrors
        .map((entry) => `${entry.source}: ${entry.text}`)
        .join("\n");
      throw new Error(`Unexpected console errors:\n${details}`);
    }
    mark("console-errors", "No unexpected console errors captured.");

    console.log("Bridge Chrome smoke checks passed.");
  } finally {
    pageServer.close();
    backendServer.close();
    if (cdp && !options.keepOpen) {
      await cdp.send("Browser.close").catch(() => {});
    }
    if (chrome && !options.keepOpen) {
      chrome.kill("SIGTERM");
    }
    if (!options.keepOpen) {
      await rm(userDataDir, {
        force: true,
        maxRetries: 3,
        recursive: true,
        retryDelay: 250
      }).catch((error) => {
        console.warn(
          `Could not remove temporary Chrome profile ${userDataDir}: ${error.message}`
        );
      });
    } else {
      console.log(`Chrome profile kept at ${userDataDir}`);
    }
  }
}

function parseArgs(args) {
  const options = {
    chromePath: "",
    extensionPath: "",
    headless: false,
    help: false,
    keepOpen: false,
    listChecks: false,
    noBrowserDownload: false,
    skipBuild: false,
    timeoutMs: 20000
  };

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--headless") options.headless = true;
    else if (arg === "--keep-open") options.keepOpen = true;
    else if (arg === "--list-checks") options.listChecks = true;
    else if (arg === "--no-browser-download") options.noBrowserDownload = true;
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg.startsWith("--chrome-path="))
      options.chromePath = arg.slice("--chrome-path=".length);
    else if (arg.startsWith("--extension-path="))
      options.extensionPath = arg.slice("--extension-path=".length);
    else if (arg.startsWith("--timeout-ms="))
      options.timeoutMs = Number(arg.slice("--timeout-ms=".length));
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) {
    throw new Error("--timeout-ms must be a positive number.");
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node scripts/smoke-bridge.mjs [options]

Development-only Chrome/CDP smoke runner for Bridge Guided Task Mode.

Options:
  --chrome-path=<path>      Chrome executable path. Defaults to CHROME_PATH or common macOS paths.
  --extension-path=<path>   Unpacked extension root. Defaults to the current working directory.
  --headless                Run Chrome with --headless=new. Use headed mode if extension UI is flaky.
  --keep-open               Leave Chrome and the temporary profile open after the run.
  --no-browser-download     Do not download Chrome for Testing when no compatible browser is found.
  --skip-build              Do not run npm run build before launching Chrome.
  --timeout-ms=<ms>         Per-check timeout. Default: 20000.
  --list-checks             Print the smoke check inventory as JSON.
  --help                    Show this help.
`);
}

async function findChromePath({ noBrowserDownload = false } = {}) {
  const installed = DEFAULT_CHROME_PATHS.find(
    (candidate) => candidate && existsSync(candidate)
  );
  if (installed) return installed;
  if (noBrowserDownload) return "";
  return ensureChromeForTesting();
}

function getCachedChromeForTestingPath(version = "stable") {
  const platform = chromeForTestingPlatform();
  if (!platform) return "";
  return path.join(
    os.homedir(),
    ".cache",
    "bridge",
    "chrome-for-testing",
    version,
    `chrome-${platform}`,
    "Google Chrome for Testing.app",
    "Contents",
    "MacOS",
    "Google Chrome for Testing"
  );
}

async function ensureChromeForTesting() {
  const metadataUrl =
    "https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json";
  const metadataResponse = await fetch(metadataUrl);
  if (!metadataResponse.ok) {
    throw new Error(
      `Failed to fetch Chrome for Testing metadata: HTTP ${metadataResponse.status}`
    );
  }

  const metadata = await metadataResponse.json();
  const platform = chromeForTestingPlatform();
  if (!platform) {
    throw new Error(`Unsupported Chrome for Testing platform: ${process.platform}/${process.arch}`);
  }

  const stable = metadata.channels?.Stable;
  const download = stable?.downloads?.chrome?.find(
    (item) => item.platform === platform
  );
  if (!stable?.version || !download?.url) {
    throw new Error(`Chrome for Testing download was not found for ${platform}.`);
  }

  const installRoot = path.join(
    os.homedir(),
    ".cache",
    "bridge",
    "chrome-for-testing",
    stable.version
  );
  const executablePath = getCachedChromeForTestingPath(stable.version);
  if (existsSync(executablePath)) return executablePath;

  const zipPath = path.join(os.tmpdir(), `bridge-chrome-for-testing-${stable.version}.zip`);
  console.log(`Downloading Chrome for Testing ${stable.version} for ${platform}...`);
  const response = await fetch(download.url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download Chrome for Testing: HTTP ${response.status}`);
  }
  await rm(installRoot, { force: true, recursive: true });
  await mkdir(installRoot, { recursive: true });
  await pipeline(response.body, createWriteStream(zipPath));
  run("unzip", ["-q", zipPath, "-d", installRoot], { cwd: process.cwd() });
  await rm(zipPath, { force: true });

  if (!existsSync(executablePath)) {
    throw new Error(`Chrome for Testing executable was not found after install: ${executablePath}`);
  }
  return executablePath;
}

function chromeForTestingPlatform() {
  if (process.platform === "darwin" && process.arch === "arm64") return "mac-arm64";
  if (process.platform === "darwin" && process.arch === "x64") return "mac-x64";
  if (process.platform === "linux" && process.arch === "x64") return "linux64";
  if (process.platform === "win32" && process.arch === "x64") return "win64";
  if (process.platform === "win32" && process.arch === "ia32") return "win32";
  return "";
}

function run(command, args, options) {
  const result = spawnSync(command, args, { stdio: "inherit", ...options });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed.`);
  }
}

function launchChrome({ chromePath, cdpPort, userDataDir, repoRoot, headless }) {
  const args = [
    `--remote-debugging-port=${cdpPort}`,
    `--user-data-dir=${userDataDir}`,
    `--disable-extensions-except=${repoRoot}`,
    `--load-extension=${repoRoot}`,
    "--enable-unsafe-extension-debugging",
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-popup-blocking",
    "--window-size=1280,900",
    "about:blank"
  ];
  if (headless) args.unshift("--headless=new");

  const chrome = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
  chrome.stderr.on("data", (chunk) => {
    const text = String(chunk).trim();
    if (text) process.stderr.write(`[chrome] ${text}\n`);
  });
  return chrome;
}

async function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function startPageServer(port) {
  const server = createServer((request, response) => {
    const url = new URL(request.url || "/", `http://127.0.0.1:${port}`);
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (url.pathname === "/next.html") {
      response.end(testPageHtml({
        title: "Bridge Smoke Next Page",
        heading: "Next page",
        buttonId: "next-action",
        buttonText: "Next page action",
        body: "This page appears after navigation so Bridge can refresh the guidance plan."
      }));
      return;
    }
    response.end(testPageHtml({
      title: "Bridge Smoke Test Page",
      heading: "Returns and orders",
      buttonId: "return-details",
      buttonText: "Show return details",
      body: "This regular http page gives Bridge a stable visible target for overlay placement."
    }));
  });
  await listen(server, port);
  return server;
}

function testPageHtml({ title, heading, buttonId, buttonText, body }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; line-height: 1.5; }
      main { max-width: 760px; }
      button, a { font: inherit; margin-top: 16px; padding: 10px 14px; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(body)}</p>
      <button id="${buttonId}" type="button">${escapeHtml(buttonText)}</button>
      <p><a id="next-page-link" href="/next.html">Open next page</a></p>
    </main>
  </body>
</html>`;
}

async function startBackendServer(port) {
  const server = createServer(async (request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method !== "POST" || request.url !== "/guidance-plan") {
      response.writeHead(404, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const payload = JSON.parse(await readBody(request));
    const pageUrl = payload?.planningPayload?.page?.url || "";
    const isNextPage = pageUrl.includes("/next.html");
    const target = isNextPage
      ? { role: "button", text: "Next page action", selector: "#next-action" }
      : { role: "button", text: "Show return details", selector: "#return-details" };
    const title = isNextPage ? "Next page action" : "Show return details";

    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(
      JSON.stringify({
        status: "ready",
        clarifiedTaskRequest: payload.taskRequest || "Find the return policy",
        summary: "Smoke-test guidance from the local fake backend.",
        steps: [
          {
            title,
            instruction: `Use the ${title} button when you are ready.`,
            target,
            risk: "low"
          }
        ]
      })
    );
  });
  await listen(server, port);
  return server;
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

async function waitForBrowserWebSocket(port, timeoutMs) {
  const versionUrl = `http://127.0.0.1:${port}/json/version`;
  const version = await waitFor(
    async () => {
      const response = await fetch(versionUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    },
    (value) => Boolean(value.webSocketDebuggerUrl),
    timeoutMs,
    "Chrome DevTools endpoint"
  );
  return version.webSocketDebuggerUrl;
}

async function waitForExtensionId(cdp, timeoutMs) {
  try {
    const target = await waitFor(
      async () => {
        const { targetInfos } = await cdp.send("Target.getTargets");
        return targetInfos.find(
          (item) =>
            item.type === "service_worker" &&
            item.url.startsWith("chrome-extension://") &&
            item.url.endsWith("/dist/background.js")
        );
      },
      Boolean,
      timeoutMs,
      "Bridge extension service worker"
    );
    return new URL(target.url).host;
  } catch (error) {
    const { targetInfos } = await cdp.send("Target.getTargets");
    const targetSummary = targetInfos
      .map((item) => `${item.type}:${item.url || item.title || "<empty>"}`)
      .slice(0, 20)
      .join("\n");
    throw new Error(`${error.message}. Visible CDP targets:\n${targetSummary}`);
  }
}

async function createAttachedTarget(cdp, url, label) {
  const { targetId } = await cdp.send("Target.createTarget", { url });
  await cdp.send("Target.activateTarget", { targetId }).catch(() => {});
  const session = await attach(cdp, targetId, label);
  return session;
}

async function attachToServiceWorker(cdp, extensionId) {
  const { targetInfos } = await cdp.send("Target.getTargets");
  const target = targetInfos.find(
    (item) =>
      item.type === "service_worker" &&
      item.url === `chrome-extension://${extensionId}/dist/background.js`
  );
  if (!target) throw new Error("Bridge service worker target was not found.");
  return attach(cdp, target.targetId, "service worker");
}

async function attach(cdp, targetId, label) {
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true
  });
  return {
    label,
    sessionId,
    send(method, params = {}) {
      return cdp.send(method, params, sessionId);
    }
  };
}

async function captureConsole(cdp, session, source, consoleErrors) {
  cdp.onMessage((message) => {
    if (message.sessionId !== session.sessionId) return;
    if (message.method === "Runtime.exceptionThrown") {
      consoleErrors.push({
        source,
        text:
          message.params?.exceptionDetails?.exception?.description ||
          message.params?.exceptionDetails?.text ||
          "Runtime exception"
      });
    }
    if (
      message.method === "Runtime.consoleAPICalled" &&
      ["error", "assert"].includes(message.params?.type)
    ) {
      consoleErrors.push({
        source,
        text: (message.params.args || [])
          .map((arg) => arg.value || arg.description || "")
          .filter(Boolean)
          .join(" ")
      });
    }
    if (
      message.method === "Log.entryAdded" &&
      ["error", "critical"].includes(message.params?.entry?.level)
    ) {
      consoleErrors.push({
        source,
        text: message.params.entry.text || "Log error"
      });
    }
  });
  await session.send("Runtime.enable").catch(() => {});
  await session.send("Log.enable").catch(() => {});
}

async function waitForLoad(session) {
  await waitFor(
    () =>
      evaluate(session, "document.readyState", {
        awaitPromise: false
      }),
    (state) => state === "interactive" || state === "complete",
    10000,
    `${session.label} load`
  );
}

async function expectPageReady(session) {
  const state = await evaluate(
    session,
    `(() => ({
      title: document.title,
      hasTarget: Boolean(document.querySelector("#return-details")),
      isHttp: location.protocol === "http:"
    }))()`
  );
  if (!state.isHttp || !state.hasTarget) {
    throw new Error(`Target test page did not load correctly: ${JSON.stringify(state)}`);
  }
}

async function expectSidePanelReady(session) {
  const state = await evaluate(
    session,
    `(() => ({
      title: document.title,
      hasBackendUrl: Boolean(document.querySelector("#backendUrlInput")),
      hasTaskRequest: Boolean(document.querySelector("#taskRequestInput")),
      hasStartGuide: Boolean(document.querySelector("#startGuideButton"))
    }))()`
  );
  if (!state.hasBackendUrl || !state.hasTaskRequest || !state.hasStartGuide) {
    throw new Error(`Side panel controls did not load correctly: ${JSON.stringify(state)}`);
  }
}

async function startGuideFromExtensionPage(session, { pageUrl, backendUrl, taskRequest }) {
  return evaluate(
    session,
    `(async () => {
      await chrome.storage.local.set({
        bridgeBackendBaseUrl: ${JSON.stringify(backendUrl)},
        bridgeModelProvider: "backend"
      });
      const tabs = await chrome.tabs.query({ url: ${JSON.stringify(pageUrl.replace(/\/[^/]*$/, "/*"))} });
      const tab = tabs.find((item) => item.url === ${JSON.stringify(pageUrl)}) || tabs[0];
      if (!tab?.id) return { ok: false, error: "Target tab was not found." };
      return await chrome.runtime.sendMessage({
        type: "BRIDGE_START_GUIDE",
        tabId: tab.id,
        provider: "backend",
        model: "backend-proxy",
        taskRequest: ${JSON.stringify(taskRequest)},
        clarificationHistory: []
      });
    })()`
  );
}

async function getDashboard(session) {
  return evaluate(
    session,
    `chrome.runtime.sendMessage({ type: "BRIDGE_GET_SESSION_DASHBOARD" })`
  );
}

async function getOverlayState(session, targetSelector) {
  return evaluate(
    session,
    `(() => {
      const overlay = document.querySelector("#bridge-guided-task-root");
      const highlight = document.querySelector("#bridge-guided-task-highlight");
      const target = document.querySelector(${JSON.stringify(targetSelector)});
      const toRect = (element) => {
        if (!element) return null;
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          top: rect.top,
          right: rect.right,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height
        };
      };
      const highlightRect = toRect(highlight);
      const targetRect = toRect(target);
      const overlap = highlightRect && targetRect
        ? Math.max(0, Math.min(highlightRect.right, targetRect.right) - Math.max(highlightRect.left, targetRect.left)) *
          Math.max(0, Math.min(highlightRect.bottom, targetRect.bottom) - Math.max(highlightRect.top, targetRect.top))
        : 0;
      return {
        hasOverlay: Boolean(overlay),
        hasHighlight: Boolean(highlight),
        overlayText: overlay?.innerText || "",
        highlightOverlapsTarget: overlap > 0,
        highlightRect,
        targetRect
      };
    })()`
  );
}

async function evaluate(session, expression, options = {}) {
  const response = await session.send("Runtime.evaluate", {
    expression,
    awaitPromise: options.awaitPromise !== false,
    returnByValue: true
  });
  if (response.exceptionDetails) {
    throw new Error(
      response.exceptionDetails.exception?.description ||
        response.exceptionDetails.text ||
        "Runtime.evaluate failed"
    );
  }
  return response.result?.value;
}

async function waitFor(producer, predicate, timeoutMs, label) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const value = await producer();
      if (predicate(value)) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(
    `Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`
  );
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mark(id, message) {
  console.log(`ok ${id} - ${message}`);
}

function isExpectedConsoleNoise(entry) {
  return /favicon\.ico|Could not establish connection/i.test(entry.text);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

class CdpConnection {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    this.socket.onmessage = (event) => this.handleMessage(event.data);
    this.socket.onclose = () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error("CDP connection closed."));
      }
      this.pending.clear();
    };
  }

  static async connect(webSocketUrl) {
    const socket = new WebSocket(webSocketUrl);
    await new Promise((resolve, reject) => {
      socket.onopen = resolve;
      socket.onerror = () => reject(new Error("Failed to connect to CDP WebSocket."));
    });
    return new CdpConnection(socket);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const message = { id, method, params };
    if (sessionId) message.sessionId = sessionId;
    this.socket.send(JSON.stringify(message));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method });
    });
  }

  onMessage(listener) {
    this.listeners.add(listener);
  }

  handleMessage(rawMessage) {
    const message = JSON.parse(rawMessage);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(
          new Error(`${pending.method} failed: ${message.error.message}`)
        );
      } else {
        pending.resolve(message.result || {});
      }
      return;
    }
    for (const listener of this.listeners) listener(message);
  }
}

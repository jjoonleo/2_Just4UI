import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_TIMEOUT_MS = 30_000;
const ROOT_ID = "bridge-guided-task-root";
const HIGHLIGHT_ID = "bridge-guided-task-highlight";
const STORAGE_BACKEND_URL_KEY = "bridgeBackendBaseUrl";
const HEADLESS = process.env.BRIDGE_SMOKE_HEADLESS === "1";

if (typeof WebSocket !== "function") {
  throw new Error("This smoke runner requires a Node.js runtime with global WebSocket support.");
}

const runState = {
  chrome: null,
  userDataDir: "",
  servers: [],
  clients: [],
};

main()
  .then(() => {
    console.log("Chrome/CDP smoke workflow passed.");
  })
  .catch((error) => {
    console.error("Chrome/CDP smoke workflow failed.");
    console.error(error?.stack || error?.message || error);
    process.exitCode = 1;
  })
  .finally(cleanup);

async function main() {
  const chromePath = findChromePath();
  const remoteDebuggingPort = await getFreePort();
  const fixtureServer = await startFixtureServer();
  const backendServer = await startStubBackend();
  runState.userDataDir = await mkdtemp(path.join(os.tmpdir(), "bridge-chrome-smoke-"));

  const chrome = launchChrome({
    chromePath,
    remoteDebuggingPort,
    userDataDir: runState.userDataDir,
  });
  runState.chrome = chrome;

  const browser = new BrowserCdp(remoteDebuggingPort);
  await browser.waitUntilReady();

  const serviceWorkerTarget = await waitForBridgeServiceWorkerTarget(browser);
  const extensionId = process.env.BRIDGE_EXTENSION_ID || extensionIdFromUrl(serviceWorkerTarget.url);

  const fixtureTarget = await browser.createTarget(`${fixtureServer.origin}/`);
  const fixturePage = await CdpClient.connect(fixtureTarget.webSocketDebuggerUrl, "target page");
  const targetPageErrors = captureConsoleErrors(fixturePage, "target page");
  await fixturePage.send("Page.enable");
  await fixturePage.send("Runtime.enable");
  await waitForPageReady(fixturePage);

  const extensionPageTarget = await browser.createTarget(
    `chrome-extension://${extensionId}/dist/sidepanel.html`,
  );
  const extensionPage = await CdpClient.connect(extensionPageTarget.webSocketDebuggerUrl, "side panel page");
  const sidePanelErrors = captureConsoleErrors(extensionPage, "side panel");
  await extensionPage.send("Runtime.enable");
  await waitForPageReady(extensionPage);

  const serviceWorker = await CdpClient.connect(serviceWorkerTarget.webSocketDebuggerUrl, "service worker");
  const serviceWorkerErrors = captureConsoleErrors(serviceWorker, "service worker");

  await extensionPage.evaluate(
    async (backendBaseUrl, storageKey) => {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({ [storageKey]: backendBaseUrl });
    },
    backendServer.origin,
    STORAGE_BACKEND_URL_KEY,
  );

  const tabId = await extensionPage.evaluate(
    async (pageUrl) => {
      const tabs = await chrome.tabs.query({ url: `${new URL(pageUrl).origin}/*` });
      if (!tabs[0]?.id) throw new Error("Smoke target tab was not visible to the extension.");
      await chrome.tabs.update(tabs[0].id, { active: true });
      return tabs[0].id;
    },
    `${fixtureServer.origin}/`,
  );

  const startResponse = await extensionPage.evaluate(
    async (targetTabId) => {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(
          {
            type: "BRIDGE_START_GUIDE",
            tabId: targetTabId,
            provider: "backend",
            taskRequest: "Find the return policy",
            model: "backend-proxy",
          },
          (response) => {
            const lastError = chrome.runtime.lastError;
            if (lastError) reject(new Error(lastError.message));
            else resolve(response);
          },
        );
      });
    },
    tabId,
  );
  assert(startResponse?.ok, `Starting guide failed: ${JSON.stringify(startResponse)}`);
  assert(
    backendServer.requests.some((request) => request.mode === "initial"),
    "Stub backend did not receive the initial guidance request.",
  );

  await waitForOverlayOnTarget(fixturePage, "#return-policy");
  const initialOverlay = await inspectOverlay(fixturePage, "#return-policy");
  assert(initialOverlay.userActionCount === 0, "Bridge performed a page action during initial render.");
  assert(initialOverlay.highlightContainsTarget, "Initial target highlight does not contain the intended target.");

  await fixturePage.send("Page.navigate", { url: `${fixtureServer.origin}/next` });
  await waitForPageReady(fixturePage);
  await waitForOverlayOnTarget(fixturePage, "#checkout-help");
  assert(
    backendServer.requests.some((request) => request.mode === "refresh"),
    "Stub backend did not receive a refresh guidance request after navigation.",
  );
  const refreshedOverlay = await inspectOverlay(fixturePage, "#checkout-help");
  assert(refreshedOverlay.highlightContainsTarget, "Refreshed target highlight does not contain the intended target.");

  await fixturePage.send("Page.navigate", { url: "chrome://extensions/" });
  await waitForDashboardStatus(extensionPage, "paused");

  const consoleErrors = [
    ...serviceWorkerErrors.errors,
    ...targetPageErrors.errors,
    ...sidePanelErrors.errors,
  ];
  assert(
    consoleErrors.length === 0,
    `Unexpected console errors:\n${consoleErrors.map((entry) => `- ${entry}`).join("\n")}`,
  );
}

function findChromePath() {
  const explicitPath = process.env.CHROME_PATH;
  const candidates = [
    explicitPath,
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      if (candidate && requireFsAccess(candidate)) return candidate;
    } catch {}
  }

  throw new Error("Could not find Chrome. Set CHROME_PATH to the Chrome executable.");
}

async function waitForBridgeServiceWorkerTarget(browser) {
  try {
    return await browser.waitForTarget(
      (target) =>
        target.type === "service_worker" &&
        (target.url.includes("/dist/background.js") ||
          (process.env.BRIDGE_EXTENSION_ID &&
            target.url.startsWith(`chrome-extension://${process.env.BRIDGE_EXTENSION_ID}/`))),
      "Bridge service worker target",
    );
  } catch (error) {
    throw new Error(
      "Chrome did not load the unpacked Bridge extension. Recent branded Google Chrome builds may ignore --load-extension; set CHROME_PATH to Chrome for Testing or Chromium for this runner." +
        (process.env.BRIDGE_SMOKE_VERBOSE ? `\nOriginal error: ${error.message}` : ""),
    );
  }
}

function requireFsAccess(filePath) {
  return existsSync(filePath);
}

function launchChrome({ chromePath, remoteDebuggingPort, userDataDir }) {
  const args = [
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${userDataDir}`,
    `--load-extension=${REPO_ROOT}`,
    `--disable-extensions-except=${REPO_ROOT}`,
    "--disable-features=DisableLoadExtensionCommandLineSwitch",
    "--enable-unsafe-extension-debugging",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking",
    "--window-size=1280,900",
    "about:blank",
  ];
  if (HEADLESS) args.unshift("--headless=new");

  const chrome = spawn(chromePath, args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
  chrome.stdout.on("data", (chunk) => {
    if (process.env.BRIDGE_SMOKE_VERBOSE) process.stdout.write(chunk);
  });
  chrome.stderr.on("data", (chunk) => {
    if (process.env.BRIDGE_SMOKE_VERBOSE) process.stderr.write(chunk);
  });
  chrome.on("exit", (code, signal) => {
    if (code && process.exitCode == null) {
      process.exitCode = 1;
      console.error(`Chrome exited unexpectedly with code ${code} signal ${signal || ""}`.trim());
    }
  });
  return chrome;
}

async function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (url.pathname === "/next") {
      writeHtml(res, fixturePageHtml({
        title: "Checkout Help",
        heading: "Checkout Support",
        body: "This page contains a stable checkout help target for refreshed guidance.",
        target: '<button id="checkout-help" type="button">Checkout Help</button>',
      }));
      return;
    }

    writeHtml(res, fixturePageHtml({
      title: "Smoke Fixture",
      heading: "Bridge Smoke Fixture",
      body: "This page contains stable targets for Guided Task Mode smoke checks.",
      target: '<a id="return-policy" href="/next">Return Policy</a>',
    }));
  });
  return listen(server);
}

function fixturePageHtml({ title, heading, body, target }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <title>${escapeHtml(title)}</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 48px; line-height: 1.5; }
      main { max-width: 720px; }
      a, button { display: inline-block; margin-top: 24px; padding: 12px 18px; font: inherit; }
    </style>
  </head>
  <body>
    <main>
      <h1>${escapeHtml(heading)}</h1>
      <p>${escapeHtml(body)}</p>
      <form aria-label="Smoke form">
        <label for="email">Email</label>
        <input id="email" name="email" placeholder="you@example.com">
      </form>
      ${target}
    </main>
    <script>
      window.__bridgeSmokeActions = { clicks: 0, inputs: 0 };
      document.addEventListener("click", (event) => {
        if (!event.target.closest("#bridge-guided-task-root")) window.__bridgeSmokeActions.clicks += 1;
      }, true);
      document.addEventListener("input", () => {
        window.__bridgeSmokeActions.inputs += 1;
      }, true);
    </script>
  </body>
</html>`;
}

async function startStubBackend() {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      applyCors(res);
      res.writeHead(204);
      res.end();
      return;
    }
    applyCors(res);
    if (req.method === "GET" && req.url === "/health") {
      writeJson(res, 200, { ok: true });
      return;
    }
    if (req.method !== "POST" || req.url !== "/guidance-plan") {
      writeJson(res, 404, { error: "Not found." });
      return;
    }
    const payload = JSON.parse(await readBody(req));
    requests.push({
      mode: payload.mode,
      pageUrl: payload.planningPayload?.page?.url || "",
    });
    writeJson(res, 200, stubGuidancePlan(payload));
  });
  const result = await listen(server);
  result.requests = requests;
  return result;
}

function stubGuidancePlan(payload) {
  const pageUrl = payload.planningPayload?.page?.url || "";
  const isNextPage = pageUrl.includes("/next");
  return {
    status: "ready",
    clarifiedTaskRequest: payload.taskRequest,
    summary: isNextPage
      ? "Use the refreshed checkout help target."
      : "Use the return policy target on the fixture page.",
    assumptions: [],
    steps: [
      {
        id: isNextPage ? "smoke-checkout-help" : "smoke-return-policy",
        title: isNextPage ? "Find checkout help" : "Find return policy",
        instruction: isNextPage
          ? "Use the Checkout Help button on the refreshed page."
          : "Use the Return Policy link on the fixture page.",
        target: {
          selector: isNextPage ? "#checkout-help" : "#return-policy",
          role: isNextPage ? "button" : "link",
          text: isNextPage ? "Checkout Help" : "Return Policy",
        },
        completion: { type: "manual", value: null },
        risk: "low",
      },
    ],
  };
}

function applyCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function writeHtml(res, html) {
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(html);
}

function writeJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function listen(server) {
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  runState.servers.push(server);
  return {
    server,
    port,
    origin: `http://127.0.0.1:${port}`,
  };
}

async function getFreePort() {
  const server = net.createServer();
  const port = await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class BrowserCdp {
  constructor(port) {
    this.port = port;
    this.origin = `http://127.0.0.1:${port}`;
  }

  async waitUntilReady() {
    await waitFor(async () => {
      const version = await this.getJson("/json/version").catch(() => null);
      return version?.webSocketDebuggerUrl;
    }, "Chrome remote debugging endpoint");
  }

  async getTargets() {
    return await this.getJson("/json/list");
  }

  async createTarget(url) {
    const target = await this.getJson(`/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (target?.webSocketDebuggerUrl) return target;
    return await this.waitForTarget((item) => item.url === url, `target ${url}`);
  }

  async waitForTarget(predicate, label) {
    return await waitFor(async () => {
      const targets = await this.getTargets();
      return targets.find((target) => predicate(target));
    }, label);
  }

  async getJson(pathname, options = {}) {
    const response = await fetch(`${this.origin}${pathname}`, options);
    if (!response.ok) throw new Error(`CDP HTTP ${pathname} failed with ${response.status}.`);
    return await response.json();
  }
}

class CdpClient {
  static async connect(webSocketUrl, label) {
    const socket = new WebSocket(webSocketUrl);
    const client = new CdpClient(socket, label);
    await client.opened;
    runState.clients.push(client);
    return client;
  }

  constructor(socket, label) {
    this.socket = socket;
    this.label = label;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    this.opened = new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    socket.addEventListener("message", (event) => this.onMessage(event));
    socket.addEventListener("close", () => {
      for (const { reject } of this.pending.values()) {
        reject(new Error(`${this.label} CDP socket closed.`));
      }
      this.pending.clear();
    });
  }

  async send(method, params = {}) {
    const id = this.nextId++;
    const payload = { id, method, params };
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify(payload));
    return await promise;
  }

  async evaluate(fn, ...args) {
    const expression = `(${fn})(...${JSON.stringify(args)})`;
    const response = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(`${this.label} evaluation failed: ${response.exceptionDetails.text}`);
    }
    return response.result?.value;
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  close() {
    this.socket.close();
  }

  onMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id) {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(`${this.label} CDP error: ${message.error.message}`));
      else pending.resolve(message.result || {});
      return;
    }
    for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
  }
}

function captureConsoleErrors(client, label) {
  const errors = [];
  client.send("Runtime.enable").catch(() => {});
  client.send("Log.enable").catch(() => {});
  client.on("Runtime.consoleAPICalled", (event) => {
    if (!["error", "assert"].includes(event.type)) return;
    errors.push(`${label}: ${event.args?.map((arg) => arg.value || arg.description || "").join(" ")}`);
  });
  client.on("Runtime.exceptionThrown", (event) => {
    errors.push(`${label}: ${event.exceptionDetails?.text || "exception thrown"}`);
  });
  client.on("Log.entryAdded", (event) => {
    if (event.entry?.level === "error") errors.push(`${label}: ${event.entry.text}`);
  });
  return { errors };
}

async function waitForPageReady(client) {
  await waitFor(async () => {
    const state = await client.evaluate(() => document.readyState);
    return state === "interactive" || state === "complete";
  }, `${client.label} ready`);
}

async function waitForOverlayOnTarget(client, selector) {
  await waitFor(async () => {
    const result = await inspectOverlay(client, selector).catch(() => null);
    return result?.hasRoot && result?.hasHighlight && result?.targetFound && result?.highlightContainsTarget;
  }, `Bridge overlay on ${selector}`);
}

async function inspectOverlay(client, selector) {
  return await client.evaluate(
    (targetSelector, rootId, highlightId) => {
      const root = document.getElementById(rootId);
      const highlight = document.getElementById(highlightId);
      const target = document.querySelector(targetSelector);
      const highlightRect = highlight?.getBoundingClientRect();
      const targetRect = target?.getBoundingClientRect();
      const actions = window.__bridgeSmokeActions || { clicks: 0, inputs: 0 };
      const contains =
        Boolean(highlightRect && targetRect) &&
        highlightRect.left <= targetRect.left &&
        highlightRect.top <= targetRect.top &&
        highlightRect.right >= targetRect.right &&
        highlightRect.bottom >= targetRect.bottom &&
        highlightRect.width > 0 &&
        highlightRect.height > 0;
      return {
        hasRoot: Boolean(root),
        hasHighlight: Boolean(highlight),
        targetFound: Boolean(target),
        highlightContainsTarget: contains,
        userActionCount: Number(actions.clicks || 0) + Number(actions.inputs || 0),
      };
    },
    selector,
    ROOT_ID,
    HIGHLIGHT_ID,
  );
}

async function waitForDashboardStatus(extensionPage, expectedStatus) {
  await waitFor(async () => {
    const response = await extensionPage.evaluate(async () => {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({ type: "BRIDGE_GET_SESSION_DASHBOARD" }, (result) => {
          const lastError = chrome.runtime.lastError;
          if (lastError) reject(new Error(lastError.message));
          else resolve(result);
        });
      });
    });
    return response?.dashboard?.status === expectedStatus;
  }, `dashboard status ${expectedStatus}`);
}

async function waitFor(check, label, timeoutMs = DEFAULT_TIMEOUT_MS) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();
      if (result) return result;
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${label}.${lastError ? ` Last error: ${lastError.message}` : ""}`);
}

function extensionIdFromUrl(url) {
  const match = /^chrome-extension:\/\/([^/]+)\//.exec(url);
  if (!match) throw new Error(`Could not read extension id from ${url}`);
  return match[1];
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

async function cleanup() {
  for (const client of runState.clients.splice(0)) {
    try {
      client.close();
    } catch {}
  }
  for (const server of runState.servers.splice(0)) {
    await new Promise((resolve) => server.close(resolve));
  }
  if (runState.chrome && !runState.chrome.killed) {
    runState.chrome.kill("SIGTERM");
    await delay(300);
    if (!runState.chrome.killed) runState.chrome.kill("SIGKILL");
  }
  if (runState.userDataDir && !process.env.BRIDGE_SMOKE_KEEP_PROFILE) {
    await rm(runState.userDataDir, { force: true, recursive: true });
  }
}

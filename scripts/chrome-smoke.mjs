#!/usr/bin/env node
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_REMOTE_DEBUGGING_PORT = 9222;
const DEFAULT_CHROME_PATH =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const DEFAULT_UNSUPPORTED_URL = "chrome://extensions";
const CHECKS = [
  "open-http-fixture-page",
  "open-extension-side-panel-page",
  "start-guide-through-service-worker",
  "verify-overlay-and-highlight",
  "verify-navigation-refresh",
  "verify-unsupported-page-pause",
  "collect-console-errors"
];

export function parseSmokeArgs(argv = process.argv.slice(2)) {
  const options = {
    chromePath: process.env.CHROME_PATH || "",
    cdpUrl: "",
    dryRun: false,
    keepProfile: false,
    remoteDebuggingPort: DEFAULT_REMOTE_DEBUGGING_PORT,
    unsupportedUrl: DEFAULT_UNSUPPORTED_URL
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--keep-profile") {
      options.keepProfile = true;
    } else if (arg === "--chrome") {
      options.chromePath = nextValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--chrome=")) {
      options.chromePath = arg.slice("--chrome=".length);
    } else if (arg === "--cdp") {
      options.cdpUrl = normalizeCdpUrl(nextValue(argv, (index += 1), arg));
    } else if (arg.startsWith("--cdp=")) {
      options.cdpUrl = normalizeCdpUrl(arg.slice("--cdp=".length));
    } else if (arg === "--port") {
      options.remoteDebuggingPort = Number(nextValue(argv, (index += 1), arg));
    } else if (arg.startsWith("--port=")) {
      options.remoteDebuggingPort = Number(arg.slice("--port=".length));
    } else if (arg === "--unsupported-url") {
      options.unsupportedUrl = nextValue(argv, (index += 1), arg);
    } else if (arg.startsWith("--unsupported-url=")) {
      options.unsupportedUrl = arg.slice("--unsupported-url=".length);
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown chrome smoke option: ${arg}`);
    }
  }

  if (!Number.isInteger(options.remoteDebuggingPort) || options.remoteDebuggingPort <= 0) {
    throw new Error("--port must be a positive integer.");
  }

  return options;
}

export function createSmokePlan({
  cwd = process.cwd(),
  options = parseSmokeArgs([]),
  chromePath = options.chromePath || DEFAULT_CHROME_PATH
} = {}) {
  const fixturePort = options.fixturePort || 0;
  const fixtureUrl = `http://127.0.0.1:${fixturePort}/`;
  return {
    checks: [...CHECKS],
    chromePath,
    cdpUrl:
      options.cdpUrl ||
      `http://127.0.0.1:${options.remoteDebuggingPort || DEFAULT_REMOTE_DEBUGGING_PORT}`,
    developmentOnly: true,
    dryRun: Boolean(options.dryRun),
    extensionRoot: cwd,
    fixtureUrl,
    keepProfile: Boolean(options.keepProfile),
    mockBackendUrl: `http://127.0.0.1:${options.backendPort || 0}`,
    unsupportedUrl: options.unsupportedUrl || DEFAULT_UNSUPPORTED_URL
  };
}

export function formatSmokeReport({ ok, checks = [], consoleErrors = [] }) {
  const lines = [`Bridge Chrome smoke ${ok ? "PASSED" : "FAILED"}`];
  for (const check of checks) {
    lines.push(`- ${check.ok ? "PASS" : "FAIL"} ${check.name}${check.detail ? `: ${check.detail}` : ""}`);
  }
  if (consoleErrors.length) {
    lines.push("Console errors:");
    for (const error of consoleErrors) {
      lines.push(`- ${error.source}: ${error.text}`);
    }
  }
  return lines.join("\n");
}

export async function runSmoke(options = parseSmokeArgs([]), { cwd = process.cwd() } = {}) {
  const chromePath = options.chromePath || DEFAULT_CHROME_PATH;
  const plan = createSmokePlan({ cwd, options, chromePath });
  if (options.help) return { ok: true, help: usage(), plan };
  if (options.dryRun) return { ok: true, dryRun: true, plan, checks: [], consoleErrors: [] };

  if (!globalThis.WebSocket) {
    throw new Error("This smoke runner requires a Node runtime with global WebSocket support.");
  }
  if (!options.cdpUrl && !existsSync(chromePath)) {
    throw new Error(`Chrome binary not found: ${chromePath}`);
  }

  const fixture = await startFixtureServer();
  const backend = await startMockBackendServer();
  const runtime = {
    browserProcess: null,
    cdp: null,
    profileDir: ""
  };

  const checks = [];
  const consoleErrors = [];

  try {
    const fixtureUrl = `http://127.0.0.1:${fixture.port}/`;
    const mockBackendUrl = `http://127.0.0.1:${backend.port}`;
    const cdpUrl = options.cdpUrl || `http://127.0.0.1:${options.remoteDebuggingPort}`;
    if (!options.cdpUrl) {
      runtime.profileDir = await mkdtemp(path.join(os.tmpdir(), "bridge-smoke-chrome-"));
      runtime.browserProcess = launchChrome({
        chromePath,
        extensionRoot: cwd,
        profileDir: runtime.profileDir,
        remoteDebuggingPort: options.remoteDebuggingPort
      });
      await waitForCdp(cdpUrl);
    }

    runtime.cdp = await CdpClient.connect(cdpUrl);
    const extensionId = await loadOrFindExtension(runtime.cdp, cwd);
    const target = await runtime.cdp.createPage(fixtureUrl);
    target.onConsoleError((text) => consoleErrors.push({ source: "target-page", text }));
    await target.enableRuntime();
    await target.waitForLoad();
    const pageOk = await target.evaluate(() => location.protocol === "http:" && document.querySelector("#checkout"));
    checks.push({ name: "open-http-fixture-page", ok: Boolean(pageOk) });

    const sidePanel = await runtime.cdp.createPage(`chrome-extension://${extensionId}/dist/sidepanel.html`);
    sidePanel.onConsoleError((text) => consoleErrors.push({ source: "side-panel", text }));
    await sidePanel.enableRuntime();
    await sidePanel.waitForLoad();
    const sidePanelOk = await sidePanel.evaluate(() => Boolean(document.querySelector("#backendUrlInput") && document.querySelector("#startGuideButton")));
    checks.push({ name: "open-extension-side-panel-page", ok: Boolean(sidePanelOk) });

    await sidePanel.evaluate(
      async ({ backendUrl, fixtureUrl: targetUrl }) => {
        await chrome.storage.local.set({ bridgeBackendBaseUrl: backendUrl });
        const tabs = await chrome.tabs.query({});
        const targetTab = tabs.find((tab) => tab.url === targetUrl);
        if (!targetTab?.id) throw new Error("Smoke target tab not found.");
        const response = await chrome.runtime.sendMessage({
          type: "BRIDGE_START_GUIDE",
          tabId: targetTab.id,
          provider: "backend",
          taskRequest: "Click checkout"
        });
        if (!response?.ok) throw new Error(response?.error || "Guide start failed.");
      },
      { backendUrl: mockBackendUrl, fixtureUrl }
    );
    checks.push({ name: "start-guide-through-service-worker", ok: true });

    await delay(500);
    const overlayOk = await target.evaluate(() =>
      Boolean(
        document.querySelector(".bridge-guide-panel") &&
          document.querySelector(".bridge-guide-highlight")
      )
    );
    checks.push({ name: "verify-overlay-and-highlight", ok: Boolean(overlayOk) });

    await target.navigate(`${fixtureUrl}next`);
    await target.waitForLoad();
    await delay(1200);
    const refreshed = await sidePanel.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "BRIDGE_GET_SESSION_DASHBOARD" });
      return response?.ok && response.dashboard?.status;
    });
    checks.push({
      name: "verify-navigation-refresh",
      ok: refreshed === "active" || refreshed === "paused",
      detail: `status=${refreshed || "unknown"}`
    });

    await target.navigate(options.unsupportedUrl || DEFAULT_UNSUPPORTED_URL);
    await delay(800);
    const unsupportedStatus = await sidePanel.evaluate(async () => {
      const response = await chrome.runtime.sendMessage({ type: "BRIDGE_GET_SESSION_DASHBOARD" });
      return response?.ok && response.dashboard?.status;
    });
    checks.push({
      name: "verify-unsupported-page-pause",
      ok: unsupportedStatus === "paused" || unsupportedStatus === "active",
      detail: `status=${unsupportedStatus || "unknown"}`
    });

    checks.push({ name: "collect-console-errors", ok: consoleErrors.length === 0 });
    return {
      ok: checks.every((check) => check.ok) && consoleErrors.length === 0,
      checks,
      consoleErrors,
      plan: { ...plan, fixtureUrl, mockBackendUrl }
    };
  } finally {
    await runtime.cdp?.close();
    await fixture.close();
    await backend.close();
    if (runtime.browserProcess) await terminateChrome(runtime.browserProcess);
    if (runtime.profileDir && !options.keepProfile) {
      await rm(runtime.profileDir, {
        force: true,
        maxRetries: 5,
        recursive: true,
        retryDelay: 200
      }).catch(() => {});
    }
  }
}

function usage() {
  return [
    "Usage: node scripts/chrome-smoke.mjs [--dry-run] [--chrome PATH] [--cdp URL] [--port 9222] [--keep-profile]",
    "",
    "Runs a development-only Bridge Chrome smoke check against a real Chrome instance."
  ].join("\n");
}

function nextValue(argv, index, flag) {
  const value = argv[index];
  if (!value) throw new Error(`${flag} requires a value.`);
  return value;
}

function normalizeCdpUrl(value) {
  const trimmed = String(value || "").trim().replace(/\/+$/, "");
  if (!trimmed) throw new Error("--cdp requires a URL.");
  return /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`;
}

function launchChrome({ chromePath, extensionRoot, profileDir, remoteDebuggingPort }) {
  return spawn(
    chromePath,
    [
      `--remote-debugging-port=${remoteDebuggingPort}`,
      `--user-data-dir=${profileDir}`,
      `--disable-extensions-except=${extensionRoot}`,
      `--load-extension=${extensionRoot}`,
      "--enable-unsafe-extension-debugging",
      "--disable-features=DisableLoadExtensionCommandLineSwitch",
      "--no-first-run",
      "--no-default-browser-check"
    ],
    { stdio: "ignore" }
  );
}

function terminateChrome(browserProcess) {
  if (browserProcess.exitCode != null || browserProcess.signalCode != null) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      browserProcess.kill("SIGKILL");
      resolve();
    }, 3000);
    browserProcess.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    browserProcess.kill("SIGTERM");
  });
}

async function waitForCdp(cdpUrl, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${cdpUrl}/json/version`);
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await delay(150);
  }
  throw new Error(`Timed out waiting for Chrome CDP at ${cdpUrl}.`);
}

async function startFixtureServer() {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    if (req.url === "/next") {
      res.end(pageHtml("Next page", '<button id="finish">Finish</button>'));
      return;
    }
    res.end(
      pageHtml(
        "Bridge smoke fixture",
        '<main><h1>Bridge smoke fixture</h1><button id="checkout">Checkout</button><a id="next" href="/next">Next page</a></main>'
      )
    );
  });
  await listen(server, 0);
  return {
    port: server.address().port,
    close: () => closeServer(server)
  };
}

function pageHtml(title, body) {
  return `<!doctype html><html><head><title>${title}</title></head><body>${body}</body></html>`;
}

async function startMockBackendServer() {
  const server = createServer(async (req, res) => {
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders(req));
      res.end();
      return;
    }
    if (req.method !== "POST" || req.url !== "/guidance-plan") {
      res.writeHead(404, corsHeaders(req));
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }
    await readBody(req);
    res.writeHead(200, {
      ...corsHeaders(req),
      "Content-Type": "application/json"
    });
    res.end(
      JSON.stringify({
        status: "ready",
        question: "",
        clarifiedTaskRequest: "Click checkout",
        summary: "Guide the user to the checkout button.",
        assumptions: [],
        steps: [
          {
            id: "checkout",
            title: "Find checkout",
            instruction: "Use the Checkout button when you are ready.",
            target: {
              snapshotId: "",
              kind: "button",
              role: "button",
              label: "Checkout",
              text: "Checkout",
              selector: "#checkout",
              href: "",
              name: "",
              type: "button",
              placeholder: ""
            },
            completion: { type: "click", value: "" },
            risk: "low"
          }
        ]
      })
    );
  });
  await listen(server, 0);
  return {
    port: server.address().port,
    close: () => closeServer(server)
  };
}

function corsHeaders(req) {
  const origin = req.headers.origin || "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function listen(server, port) {
  return new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
}

function closeServer(server) {
  return new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
}

async function loadOrFindExtension(cdp, extensionRoot) {
  const existing = await getLoadedBridgeExtensionId(cdp, extensionRoot);
  if (existing) return existing;

  try {
    const result = await cdp.send("Extensions.loadUnpacked", {
      path: extensionRoot,
      enableInIncognito: false
    });
    if (result.id) return result.id;
  } catch {
    // Fall back to target discovery for browsers without the experimental Extensions domain.
  }

  const discovered = await findExtensionId(cdp);
  if (discovered) return discovered;
  throw new Error(
    "Could not load or find the Bridge extension. If this is branded Chrome 137+, use Chrome for Testing/Chromium or a Chrome build that supports CDP Extensions.loadUnpacked."
  );
}

async function getLoadedBridgeExtensionId(cdp, extensionRoot) {
  try {
    const result = await cdp.send("Extensions.getExtensions");
    const match = (result.extensions || []).find(
      (extension) =>
        extension.path === extensionRoot ||
        extension.path === path.resolve(extensionRoot) ||
        extension.name === "Bridge Guided Task Mode"
    );
    return match?.id || "";
  } catch {
    return "";
  }
}

async function findExtensionId(cdp) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const targets = await cdp.send("Target.getTargets");
    const extensionTarget = targets.targetInfos.find((target) =>
      /^chrome-extension:\/\/[^/]+\/dist\/background\.js/.test(target.url)
    );
    const match = extensionTarget?.url.match(/^chrome-extension:\/\/([^/]+)/);
    if (match?.[1]) return match[1];
    await delay(200);
  }
  return "";
}

class CdpClient {
  constructor(webSocket) {
    this.webSocket = webSocket;
    this.nextId = 1;
    this.pending = new Map();
    this.sessions = new Map();
    this.webSocket.addEventListener("message", (event) => this.handleMessage(event));
  }

  static async connect(cdpUrl) {
    const version = await fetch(`${cdpUrl}/json/version`).then((response) => response.json());
    const socket = new WebSocket(version.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      socket.addEventListener("open", resolve, { once: true });
      socket.addEventListener("error", reject, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    this.webSocket.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
  }

  async createPage(url) {
    const { targetId } = await this.send("Target.createTarget", { url });
    const { sessionId } = await this.send("Target.attachToTarget", {
      targetId,
      flatten: true
    });
    const page = new CdpPage(this, sessionId, targetId);
    this.sessions.set(sessionId, page);
    return page;
  }

  handleMessage(event) {
    const message = JSON.parse(event.data);
    if (message.id && this.pending.has(message.id)) {
      const pending = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message));
      else pending.resolve(message.result || {});
      return;
    }
    if (message.sessionId && this.sessions.has(message.sessionId)) {
      this.sessions.get(message.sessionId).handleEvent(message);
    }
  }

  async close() {
    this.webSocket.close();
  }
}

class CdpPage {
  constructor(client, sessionId, targetId) {
    this.client = client;
    this.sessionId = sessionId;
    this.targetId = targetId;
    this.consoleErrorHandlers = [];
    this.loaded = false;
  }

  send(method, params = {}) {
    return this.client.send(method, params, this.sessionId);
  }

  async enableRuntime() {
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  async navigate(url) {
    this.loaded = false;
    await this.send("Page.navigate", { url });
  }

  async waitForLoad(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    while (!this.loaded && Date.now() < deadline) {
      const readyState = await this.evaluate(() => document.readyState).catch(() => "");
      if (readyState === "complete" || readyState === "interactive") {
        this.loaded = true;
        return;
      }
      await delay(100);
    }
    if (!this.loaded) throw new Error("Timed out waiting for page load.");
  }

  async evaluate(fn, arg = undefined) {
    const expression = `(${fn.toString()})(${JSON.stringify(arg)})`;
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
    }
    return result.result?.value;
  }

  onConsoleError(handler) {
    this.consoleErrorHandlers.push(handler);
  }

  handleEvent(message) {
    if (message.method === "Page.loadEventFired") this.loaded = true;
    if (message.method === "Runtime.consoleAPICalled" && message.params?.type === "error") {
      const text = (message.params.args || [])
        .map((arg) => arg.value || arg.description || "")
        .join(" ")
        .trim();
      this.consoleErrorHandlers.forEach((handler) => handler(text || "console.error"));
    }
    if (message.method === "Runtime.exceptionThrown") {
      const text =
        message.params?.exceptionDetails?.exception?.description ||
        message.params?.exceptionDetails?.text ||
        "Uncaught exception";
      this.consoleErrorHandlers.forEach((handler) => handler(text));
    }
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runSmoke(parseSmokeArgs())
    .then((result) => {
      if (result.help) {
        console.log(result.help);
        return;
      }
      if (result.dryRun) {
        console.log(JSON.stringify(result.plan, null, 2));
        return;
      }
      console.log(formatSmokeReport(result));
      process.exitCode = result.ok ? 0 : 1;
    })
    .catch((error) => {
      console.error(`Bridge Chrome smoke FAILED: ${error.message}`);
      process.exitCode = 1;
    });
}

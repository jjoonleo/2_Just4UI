const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");

const {
  MAX_REQUEST_BYTES,
  assertNoFormValues,
  createBridgeBackendServer,
  handleGuidancePlanPayload,
  parseProviderPlan,
  redactPlanningPayloadUrls,
} = require("../dist/backend/server.cjs");

function basePayload(overrides = {}) {
  return {
    contractVersion: 1,
    mode: "initial",
    taskRequest: "Find the return policy",
    planningPayload: {
      page: {
        url: "https://example.com/orders?token=secret#receipt",
        canonicalUrl: "https://example.com/orders?session=abc",
      },
      links: [{ href: "https://example.com/help?q=private#top" }],
      interactiveElements: [
        {
          href: "/checkout?cart=secret#pay",
          label: "Checkout",
        },
      ],
      forms: [{ label: "Email", valueIncluded: false }],
    },
    previousSession: null,
    clarificationHistory: [],
    ...overrides,
  };
}

test("redactPlanningPayloadUrls removes query strings and fragments", () => {
  const redacted = redactPlanningPayloadUrls(basePayload().planningPayload);
  assert.equal(redacted.page.url, "https://example.com/orders");
  assert.equal(redacted.page.canonicalUrl, "https://example.com/orders");
  assert.equal(redacted.links[0].href, "https://example.com/help");
  assert.equal(redacted.interactiveElements[0].href, "/checkout");
});

test("assertNoFormValues allows explicit valueIncluded false metadata", () => {
  assert.doesNotThrow(() =>
    assertNoFormValues({
      forms: [{ label: "Name", type: "text", valueIncluded: false }],
    }),
  );
});

test("assertNoFormValues rejects likely user-entered values", () => {
  assert.throws(
    () =>
      assertNoFormValues({
        forms: [{ label: "Name", value: "Ejun" }],
      }),
    /form values/i,
  );
});

test("handleGuidancePlanPayload requires BRIDGE_CODEX_MODEL for codex", async () => {
  await assert.rejects(
    () =>
      handleGuidancePlanPayload(basePayload(), {
        env: { BRIDGE_BACKEND_PROVIDER: "codex" },
        callProvider: async () => "{}",
      }),
    /BRIDGE_CODEX_MODEL/,
  );
});

test("parseProviderPlan maps invalid provider JSON to a 502 error", () => {
  assert.throws(() => parseProviderPlan("not json"), (error) => {
    assert.equal(error.statusCode, 502);
    assert.equal(error.code, "invalid_provider_json");
    return true;
  });
});

test("server rejects oversized request bodies with 413", async () => {
  const server = createBridgeBackendServer({
    env: {
      BRIDGE_BACKEND_PROVIDER: "codex",
      BRIDGE_CODEX_MODEL: "test-codex-model",
    },
    callProvider: async () => "{}",
    maxRequestBytes: 10,
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await request({
      port,
      method: "POST",
      path: "/guidance-plan",
      body: "x".repeat(MAX_REQUEST_BYTES > 10 ? 11 : 11),
    });
    assert.equal(response.statusCode, 413);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("server maps invalid provider JSON to 502", async () => {
  const server = createBridgeBackendServer({
    env: {
      BRIDGE_BACKEND_PROVIDER: "codex",
      BRIDGE_CODEX_MODEL: "test-codex-model",
    },
    callProvider: async () => "not json",
  });

  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  try {
    const response = await request({
      port,
      method: "POST",
      path: "/guidance-plan",
      body: JSON.stringify(basePayload()),
    });
    assert.equal(response.statusCode, 502);
    assert.match(response.body, /invalid JSON/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

function request({ port, method, path, body }) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        port,
        method,
        path,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            statusCode: res.statusCode,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

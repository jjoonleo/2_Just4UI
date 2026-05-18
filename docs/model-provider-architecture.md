# Model Provider Architecture

This document defines the recommended way for Bridge to use a backend proxy for plan creation while preserving Guided Task Mode boundaries.

## Goal

Bridge should treat model access as an implementation detail behind a small provider boundary. The extension should keep owning the Guidance Session, Page Snapshot, Planning Payload, Plan Contract validation, overlay rendering, and guide-only safety rules.

The provider layer should only answer one question:

> Given a Task Request, Planning Payload, planner mode, and compact session context, return a valid Plan Contract response.

## Recommended Runtime Shape

```text
Side panel
  -> start or continue Guided Task Mode
  -> background service worker
      -> collect Page Snapshot
      -> create Planning Payload
      -> call model provider adapter
          -> backend proxy adapter
              -> configured backend provider
      -> validate Plan Contract
      -> save Guidance Session
      -> inject guide overlay
```

The extension must never let model output become page automation. Model output is data for the Plan Contract, not executable commands.

## Provider Boundary

Use one internal interface for all model providers:

```js
async function createGuidancePlan({
  mode,
  taskRequest,
  planningPayload,
  previousSession,
  clarificationHistory,
}) {
  // returns raw model JSON already parsed into an object
}
```

Each provider adapter owns:

- Provider label and user-facing error text.
- Default model.
- Credential lookup.
- Request body construction.
- Structured-output or JSON-schema configuration.
- Response text extraction.
- Provider-specific retry or truncation handling.

The orchestration layer owns:

- Page Snapshot extraction.
- Planning Payload reduction.
- Completed Step History rules.
- Plan Contract validation.
- Risk Gate rules.
- Session persistence and refresh.
- Overlay rendering.

## Current Bridge Provider State

Decision: the extension-side provider path is `Backend Proxy` only. Codex or any future model provider is selected and configured behind the backend. This keeps provider credentials and provider-specific request handling out of the MV3 extension.

The side panel should collect only the backend URL and task request. The extension may preserve `bridgeModelProvider=backend` for compatibility with old storage, but it should normalize any older direct-provider values to the backend path.

Decision: extension-side Backend Proxy metadata lives in `src/shared/provider-registry.ts`. Side panel UI and service worker orchestration should read the provider id, display label, default backend URL, default model, storage keys, and credential requirement from that registry instead of duplicating provider constants.

Decision: the service worker calls the plan-creation boundary in `src/providers/provider.ts`. The Backend Proxy adapter in `src/providers/backend-provider.ts` owns backend URL normalization, `/guidance-plan` request construction, JSON response extraction, and backend error formatting. The service worker remains responsible for planner mode selection, Page Snapshot extraction, Planning Payload creation, Session State, and local Plan Contract validation.

## Backend Proxy Path

For release-oriented work, prefer a backend proxy:

```text
Extension
  -> POST /guidance-plan
      contractVersion
      mode
      taskRequest
      planningPayload
      compact previousSession
      clarificationHistory
  <- Plan Contract JSON
```

Decision: `/guidance-plan` should mirror the provider adapter input and include a contract version. It should not receive raw Page Snapshots or extension session internals.

Decision: `previousSession` should be compact continuation context, not the full extension Guidance Session. It may include the Task Request, current step index, Completed Step summaries, compact Completed Step History, compact current Guidance Step, and compact future Guidance Steps. It must not include old full Page Snapshots, raw DOM, form values, overlay DOM state, or extension storage internals.

Decision: the backend proxy must support all planner modes from the first integration: `initial`, `refresh`, and `continueAfterWindowEnded`. The proxy should not reinterpret these modes; it should pass the mode into provider request construction and return the same Plan Contract shape for each mode.

Request:

```json
{
  "contractVersion": 1,
  "mode": "initial",
  "taskRequest": "...",
  "planningPayload": {},
  "previousSession": {},
  "clarificationHistory": []
}
```

Successful response: the Plan Contract object itself, without an extra success wrapper. This lets the extension reuse the same local Plan Contract validation path used for direct providers.

Error response:

```json
{
  "error": "Human-readable error message"
}
```

The proxy should:

- Store provider secrets outside the extension.
- Enforce a request size limit.
- Restrict CORS to the configured extension origin for browser requests.
- Redact or reject disallowed page evidence before calling a model.
- Call the configured provider.
- Parse provider output as JSON.
- Return only Plan Contract JSON.
- Log operational metadata without storing full Page Snapshots or user-entered form values.

This keeps Chrome-extension code small and avoids shipping provider secrets or OAuth refresh logic to users.

Decision: the backend validates provider output as parseable JSON, while the extension remains the authority for Plan Contract semantics. If Codex returns invalid JSON, the backend should return `502` with a clear error. If the JSON parses but violates the Plan Contract or Bridge safety rules, the extension should reject it through the existing local validation path and keep the Guidance Session unchanged.

Decision: backend proxy failure should not automatically create a failed Guidance Session. During initial guide creation, no new Guidance Session should be saved and the side panel should show the error. During Plan Refresh or Guidance Continuation, the existing Guidance Session should remain unchanged and the side panel should show the Guide Activity failure. A single provider failure should not end or fail an otherwise usable guide.

Decision update: Bridge now has a TypeScript build and shared guidance-contract module. New provider work should prefer shared typed contracts over adding more duplicated Plan Contract or planning-payload behavior.

Decision: start with a repo-local backend proxy for demo integration, but keep the request and response contract deployment-oriented. The extension should treat it as a generic backend provider endpoint rather than hardcoding Codex-specific behavior throughout the UI and service worker.

Initial local shape:

```text
backend/
  server.test.js
src/backend/
  server.ts
dist/backend/
  server.cjs
  .env.example

Extension
  -> http://localhost:<port>/guidance-plan
```

Decision: the first local backend should use Node's built-in `http` server and avoid runtime dependencies. Build before running it, then start it with `node dist/backend/server.cjs`.

Decision: the first backend should read normal process environment variables only and should not auto-load `.env` with a dependency. Keep `backend/.env.example` as documentation for local setup.

Decision: the first `/guidance-plan` endpoint should enforce a 1 MB JSON request body limit. Requests over the limit should return `413` and should not be forwarded to Codex.

Decision: backend logs should be metadata-only. They may include request id, planner mode, backend provider, model, payload byte size, success/failure, latency, and error category. They must not log the full Planning Payload, raw model response, form metadata details, or page URL query strings that may contain secrets.

Decision: before calling Codex, the backend should run a final URL redaction pass over the Planning Payload. Remove query strings and fragments from page URLs, canonical URLs, link hrefs, and interactive-element hrefs. Preserve origin, host, and path when possible.

Decision: the backend should fail closed if a Planning Payload appears to contain user-entered form values. It may allow form metadata such as label, type, placeholder, required state, visibility, and `valueIncluded: false`, but it should reject non-empty fields such as `value`, `currentValue`, `typedValue`, `inputValue`, or `selectedValue` before calling Codex.

Decision: the first backend implementation should include dependency-free Node tests using the built-in test runner. Cover URL redaction, form value rejection, request body size rejection, missing Codex model configuration, and invalid provider JSON mapping to `502`. The command should be `node --test backend/*.test.js`.

Decision: backend provider selection is backend-owned configuration, not extension UI. The side panel should configure only the backend endpoint for the proxy path; local provider routing should be controlled by environment/config such as:

```bash
BRIDGE_BACKEND_PROVIDER=codex
BRIDGE_CODEX_MODEL=gpt-5.4
BRIDGE_CODEX_AUTH_FILE=~/.codex/auth.json
```

Changing the backend from Codex to another provider should not require changing the extension request contract.

Decision: the extension stores only the backend base URL for the proxy provider, not provider secrets or backend provider selection. Store it in `chrome.storage.local` with a side-panel field and default it to `http://localhost:8787`; `src/extension/service-worker/main.ts` should call `${backendBaseUrl}/guidance-plan`.

Decision: the local backend should restrict browser CORS by configuration. Use an environment variable such as `BRIDGE_EXTENSION_ORIGIN=chrome-extension://<id>` and allow that origin for extension requests. Requests without a browser `Origin` header may be allowed for local tools such as `curl`. Do not use wildcard CORS for a backend that can access Codex credentials.

Decision: the first backend implementation should support Codex only. Keep the backend request contract provider-neutral, but reject unsupported `BRIDGE_BACKEND_PROVIDER` values until another backend provider is intentionally added.

## Codex-Style Provider

Decision: Bridge integrates Codex only as a plan-creation provider. Codex receives a Planning Payload and returns a Plan Contract; it must not receive browser action tools or operate the page.

Hermes Agent uses `openai-codex` as a ChatGPT OAuth-backed provider. Technically, it:

- Runs a device-code login against OpenAI auth.
- Stores access and refresh tokens in its own auth store.
- Refreshes access tokens before runtime calls.
- Calls `https://chatgpt.com/backend-api/codex`.
- Adds Codex-client-shaped headers.
- Routes calls through the Responses API.
- Avoids hardcoding a default Codex model because the accepted model list can drift.

Decision: Codex auth and model calls live behind a backend proxy, not directly in the MV3 extension. The extension calls the proxy with the current planning request, and the proxy returns only Plan Contract JSON.

Bridge should not put the Codex OAuth implementation directly inside the MV3 extension. It is too brittle for extension-side code because it introduces private endpoint drift, token refresh races, CORS concerns, and account-token storage complexity.

Decision: the first local backend integration may read existing Codex CLI credentials from `~/.codex/auth.json`, but it must treat that file as read-only. It must not write the file or consume the Codex CLI refresh token. If the access token is missing or expired, the backend should fail with an explicit re-authentication instruction rather than attempting token refresh.

This is intentionally narrower than Hermes Agent's implementation. A later non-demo backend may implement its own device-code login and backend-owned auth store so token refresh ownership is clear.

Decision: Codex auth failures should be returned as short actionable backend errors, without raw token endpoint responses, JWT contents, stack traces, or detailed local paths beyond `~/.codex/auth.json`. Example: `Codex access token is missing or expired. Refresh Codex CLI auth, then restart the Bridge backend.`

Decision: the first Codex backend adapter should use a non-streaming request/response flow. Bridge needs one complete Plan Contract JSON object, not token-level output. Streaming, SSE, and partial plan rendering are out of scope for the first integration.

If Bridge needs a Codex-style provider, put it behind the backend proxy:

```text
Extension provider id: backend
Backend provider id: codex-oauth
Backend adapter:
  -> owns OAuth login/token refresh
  -> owns Codex endpoint headers
  -> owns Responses API request conversion
  -> returns strict Plan Contract JSON to the extension
```

Use an explicit model chosen by configuration. Do not silently fall back to a hardcoded Codex model.

Decision: the backend must require `BRIDGE_CODEX_MODEL` when `BRIDGE_BACKEND_PROVIDER=codex`. Do not hardcode a Codex model default in source. If the model is missing, the backend should fail fast with a clear configuration error.

## Official OpenAI Provider

For a stable OpenAI path, use the official OpenAI Responses API from the backend proxy.

The adapter should send:

- `instructions`: Guide-only planner rules.
- `input`: JSON string or structured input containing Task Request, Planning Payload, planner mode, previous session context, and clarification history.
- `text.format.type: "json_schema"` with the Plan Contract schema.
- `store: false` when available and appropriate for the request path.

The extension should still validate the backend response locally. Structured output reduces invalid output risk, but it does not replace Bridge policy validation.

## Privacy And Safety Rules

Every provider path must preserve these rules:

- Send a Planning Payload, not a full raw DOM.
- Do not include user-entered form values.
- Do not send screenshots unless the user explicitly enables a Visual Snapshot mode.
- Do not persist full Page Snapshots by default.
- Do not expose click, type, submit, purchase, delete, or confirm tools to the model.
- Treat Completed Step History as immutable locked history.
- Validate returned Guidance Steps before rendering.

## Implementation Order

1. Keep `src/extension/service-worker/main.ts` as the session orchestrator while factoring backend-provider and Plan Contract behavior into shared TypeScript modules.
2. Keep extension-side provider metadata in `src/shared/provider-registry.ts`; add new extension provider entries only if Bridge intentionally reintroduces extension-side providers.
3. Add provider-focused tests around backend URL handling, request construction, response parsing, and backend error messages.
4. Consider additional backend adapters only behind the proxy path.

## Non-Goals

- Do not turn Bridge into a browser automation agent.
- Do not add direct page action tools.
- Do not require Chrome DevTools Protocol for normal users.
- Do not store ChatGPT/Codex OAuth tokens in extension storage for release work.
- Do not treat provider success as Plan Contract success without local validation.

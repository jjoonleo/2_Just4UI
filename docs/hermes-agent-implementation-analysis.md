# Hermes Agent Implementation Analysis for Bridge

## Purpose

This document records what the current Bridge project does, which Hermes Agent features are relevant to it, and what implementation patterns are worth borrowing.

Sources used:

- Current Bridge repo files: `README.md`, `manifest.json`, `src/extension/sidepanel/sidepanel.html`, `src/extension/sidepanel/main.ts`, `src/extension/service-worker/main.ts`, `src/backend/server.ts`, `src/domain/guidance-contract.ts`, `backend/server.test.js`, `CONTEXT.md`.
- Hermes Agent official docs and source: `website/docs/user-guide/features/browser.md`, `mcp.md`, `skills.md`, `memory.md`, `cron.md`, `tools/browser_tool.py`, `tools/browser_cdp_tool.py`, `tools/mcp_tool.py`, `tools/memory_tool.py`, `tools/cronjob_tools.py`, `agent/browser_provider.py`, and `agent/browser_registry.py`.

## What Bridge Currently Does

Bridge is a Chrome Manifest V3 side-panel extension for guide-only page assistance. The root extension is loaded from the repo root and uses:

- `manifest.json` for side panel, background service worker, `activeTab`, `scripting`, `sidePanel`, `storage`, and `tabs` permissions.
- `src/extension/sidepanel/sidepanel.html` and `src/extension/sidepanel/main.ts` for the user-facing session dashboard, Backend Proxy URL entry, task request entry, clarification answers, auto-refresh toggle, and end-guide action.
- `src/extension/service-worker/main.ts` as the source of truth for session lifecycle, page extraction, model requests, plan validation, overlay injection, page-state refresh, and tab/window movement.
- `CONTEXT.md` as the domain language source for Page Snapshot, Planning Payload, Guidance Session, Guide-Only Assistance, Plan Refresh, Risk Gate, and Completed Step History.

The runtime flow is:

1. User opens a normal `http://` or `https://` page.
2. User opens the extension side panel.
3. User enters the Backend Proxy URL and a task request.
4. `src/extension/sidepanel/main.ts` sends `BRIDGE_START_GUIDE` to `src/extension/service-worker/main.ts`.
5. `src/extension/service-worker/main.ts` injects `collectPageSnapshotForGuide()` into the active tab.
6. The snapshot is reduced by `createPlanningPayload()` so the model receives selected page metadata, viewport data, headings, landmarks, interactive elements, form metadata, links, and selected text blocks.
7. `createGuidancePlan()` calls the Backend Proxy and asks for a strict Guidance Plan JSON contract.
8. `validateGuidancePlan()` enforces `ready` vs `needsClarification`, step caps by planner mode, required step fields, normalized targets, completion metadata, and risk level.
9. The extension injects an overlay into the original page. It highlights and explains but does not click, type, submit, purchase, delete, or confirm.
10. A single Guidance Session follows the active tab inside one browser window. Navigation, active-tab changes, tab close handoffs, and meaningful page-state changes trigger refresh or pause behavior.

Current provider state:

- `src/extension/sidepanel/sidepanel.html` exposes only Backend Proxy URL setup.
- `src/extension/sidepanel/main.ts` normalizes older provider values to Backend Proxy.
- `src/extension/service-worker/main.ts` contains Backend Proxy provider configuration only.
- `src/backend/server.ts` provides the current Backend Proxy path for Codex plan creation, with dependency-light tests in `backend/server.test.js`.

## Hermes Features Related To Bridge

### Browser Automation

Hermes has the closest overlap with Bridge here. Hermes represents pages as accessibility-tree snapshots with ref IDs like `@e1`, then exposes tools such as `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_press`, `browser_console`, `browser_vision`, and `browser_cdp`.

Bridge already has a similar extraction idea, but with a product boundary difference:

- Hermes is designed to control the browser directly.
- Bridge is designed to guide the user while the user remains in control.

Useful parts for Bridge:

- Accessibility-tree/ref-ID style page representation.
- Stable session abstraction around browser state.
- Separate snapshot, target, action, console, and CDP capabilities.
- Browser-console inspection for debugging local extension behavior.
- Vision/screenshot capability as an optional explicit visual mode, not default.

Parts to avoid in the product flow:

- Direct click/type/press as user-facing behavior.
- Autonomous form filling or submission.
- Any design where model output becomes executable page automation.

### Local Chrome Via CDP

Hermes can attach browser tools to a running Chrome instance via Chrome DevTools Protocol using `/browser connect` or `browser.cdp_url`.

Useful for Bridge development:

- Testing the unpacked extension in a live browser.
- Inspecting console errors from the side panel, background service worker, and target page.
- Reproducing target recovery and overlay placement issues.
- Inspecting tabs, frames, dialogs, cookies, and network state during debugging.

Not a direct production architecture for Bridge:

- Normal Chrome extensions should use extension APIs and content scripts, not require the user to expose a CDP port.

### MCP

Hermes can connect to external tools through MCP servers using stdio, HTTP, Streamable HTTP, or SSE. It discovers tool schemas, prefixes tool names, registers handlers into the normal tool registry, and supports include/exclude filtering per server.

Useful directions for Bridge:

- A future Bridge backend could expose page-snapshot analysis, plan validation, or regression-test helpers as MCP tools for agents.
- During development, Hermes can use a Chrome DevTools MCP server to operate a real Chrome browser while Bridge remains an extension.
- MCP filtering is a good model for limiting dangerous tools. Bridge should expose the smallest useful surface if it ever exposes extension/backend capabilities to agents.

### Skills

Hermes Skills are markdown instruction packs loaded only when needed. They support progressive disclosure: list metadata first, then load the full `SKILL.md`, then load referenced files.

Useful directions for Bridge:

- Encode Bridge domain rules as an agent skill: guide-only assistance, no form values, no auto-clicking, risk gates, immutable completed steps, and manual Chrome-extension validation.
- Keep examples and schemas as linked reference files instead of dumping them into every prompt.
- Use a Bridge-specific skill for repeatable QA workflows: load unpacked extension, open supported page, start guide, test navigation refresh, inspect console.

### Persistent Memory And Session Search

Hermes stores bounded curated memory in `MEMORY.md` and `USER.md`, injects a frozen snapshot at session start, and separately supports full-session search.

Bridge should not copy this into the extension as user-facing state. The useful pattern is conceptual:

- Keep durable project conventions in repo docs.
- Keep runtime session state minimal and task-scoped.
- Do not persist full page snapshots or user-entered values.
- Use searchable logs or test artifacts only for developer diagnostics, not user content retention.

### Cron / Scheduled Jobs

Hermes can schedule one-shot or recurring jobs, attach skills, run fresh sessions, deliver results, and run jobs inside a project directory with repo context.

Useful for Bridge development:

- Scheduled smoke checks against stable public pages.
- Periodic documentation drift checks against `README.md`, `CONTEXT.md`, and implementation.
- Regression sweeps that use browser tools to load the extension and verify no console errors.

Not useful for the extension runtime itself:

- Bridge should not background-monitor user pages or run recurring page extraction without explicit user intent.

## How Hermes Implements The Relevant Pieces

### Tool Registry Pattern

Hermes tools are normal Python functions wrapped with JSON schemas and registered into a central registry. For browser tools, `tools/browser_tool.py` defines schemas for `browser_navigate`, `browser_snapshot`, `browser_click`, `browser_type`, `browser_scroll`, `browser_back`, `browser_press`, `browser_get_images`, `browser_vision`, and `browser_console`, then registers each handler with the `browser` toolset.

The key implementation idea is the separation between:

- Tool schema: what the model is allowed to call.
- Handler: the actual implementation.
- Toolset: feature group and enablement boundary.
- Check function: whether the capability is available.

Bridge equivalent:

- Define a narrow internal command contract between side panel, background, and content script.
- Keep "guide planning", "snapshot extraction", "overlay rendering", "progress observation", and "session lifecycle" as separate command surfaces.
- Do not let model output directly call page APIs. It should only return validated data.

### Browser Session And Provider Pattern

Hermes browser tools route through a session/provider layer:

- `agent/browser_provider.py` defines the browser provider lifecycle interface.
- `agent/browser_registry.py` resolves the active provider from config and availability.
- `tools/browser_tool.py` creates or reuses a session per task ID.
- Browserbase, Browser Use, Firecrawl, Camofox, CDP override, and local `agent-browser` can all serve the same agent-facing browser tools.
- `_last_active_session_key` keeps non-navigation browser operations pointed at the session that served the last navigation.

Bridge equivalent:

- `src/extension/service-worker/main.ts` already centralizes a single active Guidance Session in `chrome.storage.local`.
- The closest improvement would be to split model providers behind a small provider interface, instead of mixing UI labels, provider defaults, fetch request construction, and error text in one file.
- Bridge should keep one product session model, but separate provider-specific model calls from session orchestration.

### Page Representation Pattern

Hermes uses accessibility snapshots and ref IDs for agent interaction. `browser_navigate` automatically takes a compact snapshot after navigation so the agent can act without a second call. `browser_snapshot` can return compact or full views and summarizes/truncates large snapshots.

Bridge currently collects richer DOM-derived structure:

- Page metadata and viewport.
- Landmarks and headings.
- Text blocks with inferred importance.
- Interactive elements with role, label, text, href, required/checked/expanded state, placeholder, selector, and bounds.
- Form metadata with `valueIncluded: false`.
- Links with same-origin flags.

Bridge should keep its richer page snapshot because overlay placement and target recovery need bounds and selectors. Hermes's ref-ID pattern is still useful: Bridge could make `snapshotId` the primary plan target and treat selectors/bounds/text as fallback evidence.

### Safety Checks

Hermes has several safety layers around browser and memory features:

- Browser navigation blocks apparent secrets in URLs.
- Browser navigation blocks private/internal URLs for cloud providers unless routed to a local sidecar or explicitly allowed.
- Browser navigation blocks cloud metadata endpoints.
- MCP stdio subprocesses receive filtered environments and server tools can be include/exclude filtered.
- Memory entries are scanned for prompt injection, exfiltration, invisible characters, and persistence payloads because memory is injected into the system prompt.

Bridge already has a strong product safety boundary in prompts and validation, but should add more mechanical defenses:

- Provider keys should move behind a backend proxy before any non-demo release.
- Model requests should have a central redaction/safety pass before sending payloads.
- The planning payload should assert and test that form values are absent.
- Model outputs should be schema-validated and then policy-validated, especially for high-risk steps.
- Any future backend should reject instructions that attempt to turn guidance into automation.

### MCP Tool Import Pattern

Hermes's MCP implementation connects to configured servers, discovers their tools, prefixes names as `mcp_<server>_<tool>`, filters tools with include/exclude config, converts schemas, registers handlers, and adds utility tools only when the server advertises resources or prompts capability.

Bridge equivalent:

- If Bridge exposes a backend, it should not expose a broad "control the page" API.
- A safe MCP surface would expose read-only or guide-only functions first: `collect_public_page_summary`, `validate_guidance_plan`, `explain_target_match`, `run_extension_smoke_check`.
- Write/control tools should be avoided unless they preserve the guide-only boundary.

### Skills And Documentation Pattern

Hermes's skills system is a good documentation design pattern for Bridge:

- Small metadata upfront.
- Full procedures loaded only when needed.
- References/examples/templates as separate files.
- Platform requirements encoded in metadata.

Bridge equivalent:

- Keep `CONTEXT.md` as the domain glossary.
- Keep `docs/page-snapshot-json.md` as the snapshot reference.
- Add separate docs for implementation architecture, model plan contract, and extension QA workflows as they become stable.

## Recommended Bridge Direction

### Borrow From Hermes

1. Use a clearer tool/session/provider architecture.
   - Keep `src/extension/service-worker/main.ts` as orchestrator, but factor model providers and plan validation into clearer TypeScript modules.

2. Adopt Hermes-style browser QA for development.
   - Use browser automation or CDP only as a developer test harness, not as user-facing behavior.
   - Test side-panel state, overlay rendering, target highlighting, console errors, and navigation refresh.

3. Add a formal provider boundary.
   - Keep request construction, response parsing, and error formatting behind the Backend Proxy path.
   - Use `docs/model-provider-architecture.md` as the Bridge-specific provider design note.

4. Strengthen mechanical safety.
   - Add payload tests proving form values are not included.
   - Add validation tests proving model outputs cannot request automation.
   - Add risk-gate tests for checkout/payment/account-deletion steps.

5. Use skills-style documentation structure.
   - Keep domain rules separate from implementation docs.
   - Keep QA procedures separate from model contract docs.

### Do Not Borrow Directly

1. Do not use direct browser click/type/press as product behavior.
   - That violates Bridge's Guide-Only Assistance boundary.

2. Do not persist full page snapshots as memory.
   - Hermes memory is for agent conventions; Bridge user page data should remain one-time and minimal.

3. Do not require CDP for normal users.
   - CDP is a developer/test tool. Chrome extension APIs are the right runtime surface.

4. Do not expose a broad MCP control API.
   - If Bridge gains MCP, start with read-only and validation tools.

## Concrete Next Work

1. Keep provider configuration aligned.
   - Maintain Backend Proxy labels across README, side panel UI, side panel defaults, and `PROVIDER_CONFIG`.
   - Keep provider-specific credentials and model defaults behind the backend before adding another provider.

2. Follow the model provider architecture note.
   - Keep the extension responsible for Guidance Session orchestration, Planning Payload creation, Plan Contract validation, and overlay rendering.
   - Put release-oriented provider secrets and any Codex-style OAuth implementation behind a backend proxy.

3. Add a Bridge QA doc.
   - Manual extension load.
   - Start guide on a public page.
   - Verify missing-key error.
   - Verify no auto-click/type behavior.
   - Verify navigation refresh and unsupported-page pause.

4. Add a model contract doc.
   - Extract `guidancePlanSchema`, `openAiGuidancePlanSchema`, and validation rules into a stable reference.

5. Expand behavior tests where possible.
   - Backend proxy tests already exist in `backend/server.test.js`; they cover URL redaction, form-value rejection, request size limits, provider JSON parsing, and required Codex model configuration.
   - The next useful tests are extension-side pure JavaScript tests around planning payload filtering, plan validation, completed-step filtering, provider label normalization, and Guide-Only policy rejection.

6. Consider a development-only Hermes workflow.
   - Use Hermes browser tools or Chrome DevTools MCP to run smoke checks against the unpacked extension.
   - Keep this out of the extension's product runtime.

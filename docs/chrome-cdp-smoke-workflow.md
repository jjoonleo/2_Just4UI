# Chrome/CDP Smoke Workflow

This workflow is for developer QA of the unpacked Bridge extension. It checks that Guided Task Mode works on normal browser pages while preserving Guide-Only Assistance.

Chrome DevTools Protocol (CDP) is optional and development-only. Bridge must not require CDP as a product runtime dependency, and CDP automation must not become a replacement for Chrome extension APIs, content scripts, or user-controlled page actions.

## Prerequisites

Build before loading or reloading the extension:

```bash
npm install
npm run build
```

The automated development smoke runner does the build, starts a local test page, starts a fake Backend Proxy, launches a temporary Chrome profile with the unpacked extension, and runs the core checks:

```bash
npm run smoke:chrome
```

The runner uses Chrome for Testing when possible and downloads it into `~/.cache/bridge/chrome-for-testing` when no compatible local browser is available. Recent branded Chrome builds may ignore command-line unpacked-extension loading, so use Chrome for Testing or Chromium for automated runs.

Useful runner options:

```bash
npm run smoke:chrome -- --headless
npm run smoke:chrome -- --keep-open
npm run smoke:chrome -- --chrome-path="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
npm run smoke:chrome -- --no-browser-download
npm run smoke:chrome -- --list-checks
```

Use a regular `http://` or `https://` page for smoke checks. Chrome blocks extension injection on internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages.

For provider-backed happy-path checks, start the local backend proxy:

```bash
BRIDGE_BACKEND_PROVIDER=codex \
BRIDGE_CODEX_MODEL=<codex-model> \
BRIDGE_EXTENSION_ORIGIN=chrome-extension://<extension-id> \
node dist/backend/server.cjs
```

For missing-backend checks, leave the backend stopped or set the side panel backend URL to an unused local port.

## Load The Unpacked Extension

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the repository root for the checkout being tested. The primary local checkout is `/Users/ejunpark/Documents/brigde_hakerthon`.
5. After rebuilding, click the extension's reload button on `chrome://extensions`.

Expected result: Chrome loads Bridge from the repo root and reports no manifest or service-worker registration errors.

## Open The Side Panel

1. Open a supported `http://` or `https://` page.
2. Click the Bridge extension action in Chrome's toolbar.
3. Confirm the side panel opens.

Expected result: the Side Panel shows the Backend Proxy URL field, Task Request field, and Guided Task Mode controls. If a Guidance Session is already active, the Session Dashboard should show the current Session Status and Guide Activity instead of losing session state.

## Missing Backend Behavior

1. Stop the backend proxy or enter an unused backend URL, such as `http://localhost:9`.
2. Enter a Task Request.
3. Start Guided Task Mode.

Expected result: the Side Panel reports the provider/backend error clearly. Bridge should not save a new failed Guidance Session, should not inject a stale overlay, and should not ask the page to click, type, submit, purchase, delete, or confirm anything.

## Overlay Rendering

1. Start the backend proxy with valid local configuration.
2. Open a supported page with visible links, buttons, or form fields.
3. Enter a Task Request that can be answered from the visible page, such as `Find the return policy`.
4. Start Guided Task Mode.

Expected result: Bridge creates a Guidance Plan, injects one guide overlay into the original page, and keeps the page's own interface intact. The overlay should explain the current Guidance Step and should not block the primary Page Target.

## Target Highlight Placement

1. With a guide active, inspect the highlighted Page Target.
2. Scroll if needed and compare the highlight with the intended target text, label, role, or link destination.
3. Advance only after the user manually performs the page action.

Expected result: the highlight points to the intended Page Target. Bridge may highlight, scroll, explain, and observe progress, but the user performs every page action. The guide must not click, type, submit, purchase, delete, confirm, or choose values for the user.

## Navigation And Active-Tab Refresh

1. Start a guide on a supported page.
2. Manually navigate through the highlighted Page Target or switch to another supported tab in the same Chrome window.
3. Watch the Side Panel while the refresh is in progress.

Expected result: Bridge removes the stale page overlay during Plan Refresh, shows Guide Activity in the Side Panel, collects a fresh Page Snapshot, and renders refreshed guidance on the current Session Host Tab. Completed Step History should remain intact.

## Unsupported-Page Pause

1. Start a guide on a supported page.
2. Switch the same Chrome window to an unsupported page such as `chrome://extensions`.

Expected result: Bridge removes the stale overlay and turns the session into a Paused Guidance Session. The Side Panel should explain that the active page is unsupported. Returning to a supported page in the same Session Window should allow the guide to refresh instead of leaving the old unsupported-page state stuck.

## Development-Only CDP

CDP can help observe the smoke workflow, especially console errors from the page, side panel, or service worker. It should be used only as a development harness.

One local pattern is to run a separate Chrome profile with a debugging port:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/bridge-cdp-profile
```

Then use browser automation or DevTools against `http://127.0.0.1:9222` to:

- Open supported pages for smoke checks.
- Observe console errors and failed network requests.
- Confirm the overlay appears only on the current Session Host Tab.
- Confirm unsupported pages do not retain stale overlays.
- Confirm Bridge never performs page actions for the user.

Do not treat a passing CDP run as a product dependency. Normal users should only need Chrome's extension runtime, the unpacked extension, and the configured Backend Proxy.

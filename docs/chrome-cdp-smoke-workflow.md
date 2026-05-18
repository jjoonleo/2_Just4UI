# Chrome/CDP Smoke Workflow

This workflow is for Bridge development QA. It uses a real Chrome profile and, optionally, Chrome DevTools Protocol as a test harness. CDP is not a product runtime dependency and must not be required for normal Bridge users.

## Purpose

Use this smoke workflow after extension or backend changes that affect:

- side panel startup and dashboard state
- Backend Proxy URL handling
- missing backend or backend error behavior
- overlay rendering and target highlight placement
- navigation, active-tab movement, and refresh
- unsupported-page pause behavior
- console errors in the side panel, service worker, or target page

Bridge remains Guide-Only Assistance during these checks. The extension may explain, highlight, scroll, and observe; it must not click, type, submit, purchase, delete, confirm, or otherwise perform page actions for the user.

## Build And Load

Build the generated extension files before loading Chrome:

```bash
npm install
npm run build
```

Load this repository root as the unpacked extension:

```text
/Users/ejunpark/Documents/brigde_hakerthon
```

In Chrome:

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select the repository root.
5. Confirm the extension action opens the Bridge side panel.

Chrome blocks injection into internal pages such as `chrome://extensions`, the Chrome Web Store, and browser-owned pages. Run guide smoke checks on normal `http://` or `https://` pages.

## Backend States

Check the missing-backend path first:

1. Open a normal page, such as a local static page or `https://example.com`.
2. Open the Bridge side panel.
3. Leave the Backend Proxy URL at `http://localhost:8787`.
4. Start a guide while the backend is not running.
5. Confirm the side panel shows a clear backend failure and no stale overlay remains on the page.

Then check the running-backend path:

```bash
npm run build
BRIDGE_BACKEND_PROVIDER=codex \
BRIDGE_CODEX_MODEL=<codex-model> \
BRIDGE_EXTENSION_ORIGIN=chrome-extension://<extension-id> \
node dist/backend/server.cjs
```

Start a guide again on a supported page. Confirm the side panel enters an active guidance state only after a valid Guidance Plan is available.

## Overlay And Highlight Checks

Use a page with visible links, buttons, and form metadata. For each guide:

1. Enter a Task Request that should resolve to one obvious Page Target.
2. Confirm the overlay appears on the original page.
3. Confirm the highlighted target is visible and not hidden behind the overlay.
4. Confirm page controls remain usable by the user.
5. Confirm Bridge does not click, type, submit, purchase, delete, or confirm anything.
6. Check the target page console for extension-related errors.

For high-risk steps, confirm the Risk Gate appears before the user-facing instruction continues. The Risk Gate warns; it does not perform the action.

## Refresh And Pause Checks

Navigation refresh:

1. Start a guide on a supported `http://` or `https://` page.
2. Complete a step that navigates, or manually navigate the same tab.
3. Confirm the old overlay is removed during refresh.
4. Confirm the side panel shows Guide Activity while the refresh is in progress.
5. Confirm refreshed guidance uses the new page evidence.
6. Confirm Completed Step History is preserved and not rewritten.

Active-tab movement:

1. Start a guide in one Chrome window.
2. Switch to another supported tab in the same window.
3. Confirm the old tab no longer shows the guide.
4. Confirm the active tab becomes the Session Host Tab after refresh.
5. Switch to a different Chrome window and confirm the session does not follow there.

Unsupported-page pause:

1. Start a guide on a supported page.
2. Navigate the Session Host Tab to `chrome://extensions`.
3. Confirm the guide is paused or fails cleanly.
4. Confirm the stale overlay is not left on the previous page.
5. Return to a supported page in the same Session Window and confirm the session can refresh or remain controllable from the side panel.

## Optional CDP Harness

For repeatable development checks, use the repo smoke runner:

```bash
npm run smoke:chrome -- --dry-run
npm run smoke:chrome
```

The dry run prints the planned development-only checks without launching Chrome. The full run builds the extension, starts local fixture/backend servers, launches Chrome with this repo as the unpacked extension, drives the guide through CDP, and reports failed checks or captured console errors.

To attach to an already running Chrome instance, launch a separate Chrome profile with remote debugging enabled:

```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/bridge-smoke-chrome \
  --disable-extensions-except=/Users/ejunpark/Documents/brigde_hakerthon \
  --load-extension=/Users/ejunpark/Documents/brigde_hakerthon \
  --enable-unsafe-extension-debugging \
  --disable-features=DisableLoadExtensionCommandLineSwitch
```

Official branded Chrome builds from Chrome 137 may ignore command-line unpacked extension loading. If the runner cannot discover the Bridge extension service worker, use Chrome for Testing, Chromium, or an already loaded unpacked extension profile exposed through `--cdp`.

Then run:

```bash
npm run smoke:chrome -- --cdp http://127.0.0.1:9222
```

Use CDP only to drive and inspect the development browser:

- open supported test pages
- open or inspect extension pages where feasible
- collect console errors
- inspect target bounds and screenshots for overlay placement
- reproduce navigation refresh and unsupported-page pause behavior

Do not add CDP or browser automation as a Bridge runtime dependency. Do not expose CDP-backed click, type, submit, purchase, delete, or confirm behavior through the extension.

## Handoff Checklist

Before handing off a browser-facing change, record:

- Chrome version and extension id used for the smoke run
- page URL or local fixture used
- backend state tested: missing backend, running backend, or both
- whether side panel startup passed
- whether overlay and highlight placement passed
- whether navigation or active-tab refresh passed
- whether unsupported-page pause passed
- console errors from the side panel, service worker, and target page

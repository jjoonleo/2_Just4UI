# Chrome/CDP Smoke Workflow

This is a development-only QA workflow for Bridge Guided Task Mode. It uses normal Chrome extension loading and may use Chrome DevTools Protocol (CDP) or browser automation to observe the browser during development, but CDP is not a product runtime dependency.

Bridge runtime behavior stays inside the MV3 extension, the side panel, the service worker, content-script injection, and the optional backend proxy. A smoke runner may open pages, collect console errors, and inspect rendered UI, but it must not click, type, submit, purchase, delete, confirm, or otherwise perform page actions as product behavior for the user.

## Build And Load

1. Run `npm install` if dependencies are not installed.
2. Run `npm run build`.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the Bridge checkout root. The primary local demo checkout is `/Users/ejunpark/Documents/brigde_hakerthon`; when validating a worktree, select that worktree root instead.
7. Open a normal `http://` or `https://` page before starting a guide.

Do not use `chrome://extensions`, Chrome Web Store pages, browser settings pages, or other browser-owned pages as positive overlay-rendering cases. Chrome blocks extension injection on those pages, so they are only useful for unsupported page checks.

## Optional CDP Harness

Use CDP only as a development harness around Chrome. A harness may:

- Open a normal HTTP/HTTPS test page.
- Verify the extension action can open the side panel.
- Read target page, side panel, and service worker console errors where Chrome exposes them.
- Inspect whether Bridge overlay nodes render on the original page.
- Check target highlight placement by comparing the highlight box with the intended page target.
- Drive navigation to another normal page or activate another tab to verify Plan Refresh behavior.
- Visit an unsupported page to verify the session pauses cleanly.

A harness must not become required for normal users. The extension must continue to work through Chrome extension APIs without a remote debugging port.

## Automated Smoke Runner

Run the opt-in smoke runner after building source changes:

```bash
npm run smoke:chrome
```

The script starts a temporary Chrome profile with this repository loaded as an unpacked extension, serves local HTTP fixture pages, starts a deterministic stub backend, and connects to Chrome over CDP. It does not call Codex or any remote model provider.

The automated runner checks:

- The unpacked extension exposes a service worker and side panel page.
- A normal HTTP fixture page can start Guided Task Mode through the existing extension message contract.
- The stub backend receives an `initial` guidance request and later a `refresh` guidance request.
- The overlay root and highlight render on the original page.
- The highlight contains the intended Page Target on the initial page and after navigation refresh.
- Navigation on the Session Host Tab refreshes guidance with fresh page evidence.
- Navigation to a Chrome-owned page pauses the session cleanly.
- Console errors are absent from the target page, side panel page, and service worker when those CDP targets are available.

Set `CHROME_PATH=/path/to/chrome` if Chrome is not in the default location. Prefer Chrome for Testing or Chromium for this runner because recent branded Google Chrome builds may ignore command-line unpacked extension loading. Set `BRIDGE_EXTENSION_ID=<id>` when attaching to an already-loaded development extension, `BRIDGE_SMOKE_HEADLESS=1` to request Chrome's new headless mode, or `BRIDGE_SMOKE_VERBOSE=1` to print Chrome process output while debugging.

Keep this script opt-in. It launches a real browser and should not run as part of ordinary `npm test` unless a future CI environment explicitly supports Chrome extension smoke checks.

## Manual Smoke Checks

### Side Panel

1. Click the Bridge extension action.
2. Confirm the side panel opens.
3. Confirm the setup controls show the **Backend Proxy** URL field and task request field.
4. Start without a reachable backend:
   - Leave the backend URL empty, use an invalid backend URL, or stop the backend.
   - Verify missing backend or backend connection behavior is clear.
5. Confirm the Session Dashboard updates when a guide starts, refreshes, pauses, or ends.

### Overlay And Target Highlight

1. Open a normal HTTP/HTTPS page with visible buttons, links, or inputs.
2. Start a guide with a simple Task Request such as `Find the return policy`.
3. Confirm the overlay renders on the original page.
4. Confirm the target highlight is near the intended Page Target and does not block the target.
5. Confirm the guide explains and highlights only. It must not click the target, must not type into fields, and must not submit forms.
6. Confirm page controls still respond to the user's own actions.

### Navigation And Active-Tab Refresh

1. Start a guide on a normal page.
2. Navigate the Session Host Tab or activate another normal tab in the same Session Window.
3. Confirm Bridge starts Guide Activity for refresh in progress.
4. Confirm the stale overlay is removed during refresh and the generated guide list is hidden while refresh is in progress.
5. Confirm refreshed guidance renders on the new page or active-tab host after the new Page Snapshot and Guidance Plan are ready.
6. If a soft page-state refresh fails, confirm the previous guide is restored when possible and the Session Dashboard reports the issue.
7. Use **Pause auto refresh** and confirm Page State Change refresh pauses for the current Guidance Session, then use **Resume auto refresh** and confirm refresh can resume.

### Unsupported Page Pause

1. Start a guide on a supported HTTP/HTTPS page.
2. Move the Session Host Tab to an unsupported page, such as a Chrome-owned page.
3. Confirm Bridge removes any stale overlay.
4. Confirm the session becomes a Paused Guidance Session instead of silently ending.
5. Return to a supported HTTP/HTTPS page or activate a supported tab in the same Session Window and confirm the guide can refresh or continue.

### Console Errors

For each smoke run, capture console errors where feasible from:

- The target page.
- The side panel extension page.
- The MV3 service worker.

Unexpected console errors should fail the smoke run unless they are known browser noise and recorded with a reason.

## Pass Criteria

- The unpacked extension loads from the repository root after `npm run build`.
- The side panel opens from the extension action.
- Missing backend and unsupported page cases are clear to the user.
- Overlay rendering and target highlight placement work on normal HTTP/HTTPS pages.
- Navigation, active-tab changes, and Page State Change refresh do not leave stale overlays behind.
- **Pause auto refresh** affects only the current Guidance Session.
- Bridge never performs page actions for the user.
- CDP/browser automation remains development-only and out of production extension behavior.

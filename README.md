# Bridge Guided Task Mode

Chrome extension prototype that guides a user through a task on the original browser page instead of regenerating or automating the page.

## Guided Task Mode Prototype

Build the TypeScript source before loading or testing the extension:

```bash
npm install
npm run build
```

1. Open a normal `http://` or `https://` page.
2. Open the extension side panel.
3. Enter the Backend Proxy URL.
4. Enter a task such as `Find the return policy` or `Help me buy this item with quantity 2`.
5. Click **Start guide**.

The extension collects a reduced planning payload, calls the **Backend Proxy** plan-creation provider, validates the returned Guidance Plan JSON, and injects a guide overlay into the original page. The backend proxy can call Codex using read-only Codex CLI credentials while keeping provider credentials out of the extension. The overlay highlights targets and explains each step, but it does not click, type, submit, purchase, delete, or confirm for the user.

Guidance sessions follow one active tab in the same browser window. If the user navigates, switches to another tab in that window, or closes the current guide tab while another tab remains active, the background service worker collects fresh page evidence, asks the selected provider to refresh the plan using the original task and recent progress, removes the old overlay, and restores the guide on the new host tab. Unsupported pages pause the session without keeping a stale overlay; a second refresh failure, closing the session window, explicitly ending the guide, replacing it with a new guide, or a stale 30-minute session expires it.

The extension stores only the backend URL in `chrome.storage.local`; provider credentials remain outside the extension.

## Backend Proxy

The first backend proxy is dependency-free Node.js and supports Codex plan creation only.

1. Refresh Codex CLI auth if needed.
2. Start the backend:

```bash
npm run build
BRIDGE_BACKEND_PROVIDER=codex \
BRIDGE_CODEX_MODEL=<codex-model> \
BRIDGE_EXTENSION_ORIGIN=chrome-extension://<extension-id> \
node dist/backend/server.cjs
```

Optional settings:

- `BRIDGE_BACKEND_PORT`, default `8787`
- `BRIDGE_CODEX_AUTH_FILE`, default `~/.codex/auth.json`
- `BRIDGE_CODEX_BASE_URL`, default `https://chatgpt.com/backend-api/codex`

The backend reads `~/.codex/auth.json` as read-only local demo credentials. It does not write Codex auth files or consume the refresh token.

## Load in Chrome

1. Run `npm install` once.
2. Run `npm run build` after source changes.
3. Open `chrome://extensions`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select this folder: `/Users/ejunpark/Documents/brigde_hakerthon`.
7. Open a normal web page, click the extension to open the side panel, then start Guided Task Mode.

Chrome blocks extensions from injecting scripts into internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages. Test on regular `http://` or `https://` pages.

## Development Commands

```bash
npm run typecheck
npm test
npm run build
```

## Architecture

Bridge source is organized by Chrome extension runtime boundary under `src/`. See `docs/chrome-extension-architecture.md` for the folder map, dependency rules, and the expected refactor path for the MV3 service worker.

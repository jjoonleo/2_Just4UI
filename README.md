# Bridge Guided Task Mode

Chrome extension prototype that guides a user through a task on the original browser page instead of regenerating or automating the page.

## Guided Task Mode Prototype

1. Open a normal `http://` or `https://` page.
2. Open the extension side panel.
3. Choose **Backend Proxy**, **Gemini Demo**, or **OpenAI Demo** from **Provider**.
4. For **Backend Proxy**, enter the backend URL. For demo providers, paste the matching API key.
5. Enter a task such as `Find the return policy` or `Help me buy this item with quantity 2`.
6. Click **Start guide**.

The extension collects a reduced planning payload, calls the selected plan-creation provider, validates the returned Guidance Plan JSON, and injects a guide overlay into the original page. The default **Backend Proxy** provider sends the planning request to a local backend that can call Codex using read-only Codex CLI credentials. The **Gemini Demo** provider calls Gemini `generateContent` with `responseMimeType: "application/json"` and `responseJsonSchema`; **OpenAI Demo** calls the OpenAI Responses API with structured JSON output. The overlay highlights targets and explains each step, but it does not click, type, submit, purchase, delete, or confirm for the user.

Guidance sessions follow one active tab in the same browser window. If the user navigates, switches to another tab in that window, or closes the current guide tab while another tab remains active, the background service worker collects fresh page evidence, asks the selected provider to refresh the plan using the original task and recent progress, removes the old overlay, and restores the guide on the new host tab. Unsupported pages pause the session without keeping a stale overlay; a second refresh failure, closing the session window, explicitly ending the guide, replacing it with a new guide, or a stale 30-minute session expires it.

Prototype limitation: demo provider API keys are stored in `chrome.storage.local` and used directly by the extension. This is acceptable only for local demo work. The backend proxy path stores only the backend URL in extension storage; provider credentials remain outside the extension.

## Backend Proxy

The first backend proxy is dependency-free Node.js and supports Codex plan creation only.

1. Refresh Codex CLI auth if needed.
2. Start the backend:

```bash
BRIDGE_BACKEND_PROVIDER=codex \
BRIDGE_CODEX_MODEL=<codex-model> \
BRIDGE_EXTENSION_ORIGIN=chrome-extension://<extension-id> \
node backend/server.js
```

Optional settings:

- `BRIDGE_BACKEND_PORT`, default `8787`
- `BRIDGE_CODEX_AUTH_FILE`, default `~/.codex/auth.json`
- `BRIDGE_CODEX_BASE_URL`, default `https://chatgpt.com/backend-api/codex`

The backend reads `~/.codex/auth.json` as read-only local demo credentials. It does not write Codex auth files or consume the refresh token.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/ejunpark/Documents/brigde_hakerthon`.
5. Open a normal web page, click the extension to open the side panel, then start Guided Task Mode.

Chrome blocks extensions from injecting scripts into internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages. Test on regular `http://` or `https://` pages.

## Gemini API Key Troubleshooting

If Gemini returns `Requests to this API generativelanguage.googleapis.com method ... GenerateContent are blocked`, the pasted key is not allowed to call the Gemini Developer API. Create a Gemini API key from Google AI Studio, or update the key in Google Cloud Console so its API restrictions allow **Generative Language API** (`generativelanguage.googleapis.com`). If you changed API settings moments ago, wait a few minutes and retry.

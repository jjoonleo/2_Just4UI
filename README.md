# Bridge Browser Assistance Prototype

Chrome extension prototype with two assistance modes for the current browser page:

- **UI Regeneration** simplifies the current page into a clearer, easier-to-read layout.
- **Guided Task Mode** keeps the original page intact and shows step-by-step guidance for a user task.

## 1. UI Regeneration

1. Open a normal `http://` or `https://` page.
2. Open the extension side panel.
3. Paste a Gemini API key.
4. Click **Simplify current page** in the **Simplify Current Page** panel.

This mode uses the PersonaLens simplify flow. The extension injects `content.js`, extracts a visible DOM summary, asks Gemini for a reconstruction plan, and applies the result back to the original page with `APPLY_ACTIONS`. The regenerated UI reuses existing page elements, enlarges and reorganizes important content, and hides clutter. Click **Reset simplified page** to restore the original page structure.

## 2. Guided Task Mode

1. Open a normal `http://` or `https://` page.
2. Open the extension side panel.
3. Paste a Gemini API key.
4. Enter a task such as `Find the return policy` or `Help me buy this item with quantity 2`.
5. Click **Start guide**.

The extension collects a reduced planning payload, calls the Gemini `generateContent` API with structured JSON output, validates the returned Guidance Plan JSON, and injects a guide overlay into the original page. Gemini uses `responseMimeType: "application/json"` with `responseJsonSchema`. The overlay highlights targets and explains each step, but it does not click, type, submit, purchase, delete, or confirm for the user.

Guidance sessions follow one active tab in the same browser window. If the user navigates, switches to another tab in that window, or closes the current guide tab while another tab remains active, the background service worker collects fresh page evidence, asks Gemini to refresh the plan using the original task and recent progress, removes the old overlay, and restores the guide on the new host tab. Unsupported pages pause the session without keeping a stale overlay; a second refresh failure, closing the session window, explicitly ending the guide, replacing it with a new guide, or a stale 30-minute session expires it.

Prototype limitation: the API key is stored in `chrome.storage.local` and used directly by the extension. This is acceptable only for local demo work. A backend proxy is required before a real release.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/ejunpark/Documents/brigde_hakerthon`.
5. Open a normal web page, click the extension to open the side panel, then use either **Simplify current page** or **Start guide**.

Chrome blocks extensions from injecting scripts into internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages. Test on regular `http://` or `https://` pages.

## Gemini API Key Troubleshooting

If Gemini returns `Requests to this API generativelanguage.googleapis.com method ... GenerateContent are blocked`, the pasted key is not allowed to call the Gemini Developer API. Create a Gemini API key from Google AI Studio, or update the key in Google Cloud Console so its API restrictions allow **Generative Language API** (`generativelanguage.googleapis.com`). If you changed API settings moments ago, wait a few minutes and retry.

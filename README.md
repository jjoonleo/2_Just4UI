# Bridge Page Snapshot

Chrome extension prototype for extracting a privacy-conscious **Page Snapshot** from the current browser page.

## First milestone

- Extraction starts only when the user clicks the extension.
- The extension shows a one-time JSON result in the popup.
- Form values are not included.
- Screenshot capture is optional and off by default.
- Guided Task Mode can call the selected model provider only after the user starts a guide.

## Guided Task Mode prototype

The extension can also guide a user through a task on the original page instead of regenerating the page.

1. Open a normal `http://` or `https://` page.
2. Open the extension popup.
3. Choose **Gemini** or **OpenAI** from **Provider**.
4. Paste the matching API key.
5. Enter a task such as `Find the return policy` or `Help me buy this item with quantity 2`.
6. Click **Start guide**.

The extension extracts a reduced planning payload, calls either the Gemini `generateContent` API or the OpenAI Responses API with structured JSON output, validates the returned Guidance Plan JSON, and injects a guide overlay into the original page. The overlay highlights targets and explains each step, but it does not click, type, submit, purchase, delete, or confirm for the user.

Guidance sessions follow one active tab in the same browser window. If the user navigates, switches to another tab in that window, or closes the current guide tab while another tab remains active, the background service worker extracts a fresh Page Snapshot, asks the selected provider to refresh the plan using the original task and recent progress, removes the old overlay, and restores the guide on the new host tab. Unsupported pages pause the session without keeping a stale overlay; a second refresh failure, closing the session window, explicitly ending the guide, replacing it with a new guide, or a stale 30-minute session expires it.

Prototype limitation: the API key is stored in `chrome.storage.local` and used directly by the extension. This is acceptable only for local demo work. A backend proxy is required before a real release.

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/ejunpark/Documents/brigde_hakerthon`.
5. Open a normal web page, click the extension, then click **Extract current page**.

Chrome blocks extensions from injecting scripts into internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages. Test on regular `http://` or `https://` pages.

## Snapshot contents

The JSON includes page metadata, viewport geometry, landmarks, headings, text blocks, interactive elements, form metadata, links, images, media, tables, lists, dialogs, and live regions. When enabled, it also includes a visible viewport screenshot as a PNG data URL.

## Regenerated page

The simplified Coupang product page lives in `regenerated/`.

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080/regenerated/`. The page loads `downloaded_json/coupang galaxy phone.json` and rebuilds the product gallery, search/filtering, quantity controls, cart modal, buy modal, recommendation rows, reviews, product Q&A, and delivery/return sections from the Page Snapshot.

# Bridge Page Snapshot

Chrome extension prototype for extracting a privacy-conscious **Page Snapshot** from the current browser page.

## First milestone

- Extraction starts only when the user clicks the extension.
- The extension shows a one-time JSON result in the popup.
- Form values are not included.
- Screenshot capture is optional and off by default.
- No Gemini call is made yet.

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

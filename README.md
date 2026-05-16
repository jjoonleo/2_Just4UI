# Bridge Page Snapshot

Chrome extension prototype for extracting a privacy-conscious **Page Snapshot** from the current browser page.

## First milestone

- Extraction starts only when the user clicks the extension.
- The extension shows a one-time JSON result in the popup.
- Form values are not included.
- Screenshot capture is optional and off by default.
- No Gemini call is made yet.

## Live UI patch prototype

This branch adds a behavior-preserving prototype for staged UI simplification:

- **Build Page Analysis request** converts the latest **Page Snapshot** into a copy/paste prompt for Gemini to identify page type, primary tasks, critical content, low-value regions, and preserved interactive nodes.
- **Build Strategy request** asks Gemini for a non-executable simplification direction from the accepted Page Analysis.
- **Build Patch Plan request** asks Gemini for a compact shell-based **Patch Plan** from the accepted artifacts, not from the full snapshot again.
- **Apply JSON patch** expects Gemini to return a **Patch Plan** JSON object with safe shell operations. The extension applies that plan to the already-loaded tab.
- **Apply demo patch** injects a local CSS-first patch so the flow can be tested without calling Gemini.
- **Reset patch** removes the prototype shell, style tag, badge, classes, inline styles, safe attributes, and restores any relocated non-interactive nodes.

The prototype intentionally does not regenerate the page and does not call Gemini directly. The behavior-preserving path is: extract a snapshot, create staged copy/paste Gemini prompts, then apply a local **Patch Plan** that creates a Simplified Shell. Interactive controls stay in their original DOM context and are exposed through shell actions; only non-interactive content may be relocated.

Copy/paste flow:

1. Click **Extract current page**.
2. Click **Build Page Analysis request**, paste it into Gemini, paste the Page Analysis JSON back, then click **Accept Page Analysis**.
3. Click **Build Strategy request**, paste it into Gemini, paste the Strategy JSON back, then click **Accept Strategy**.
4. Click **Build Patch Plan request**, paste it into Gemini, then paste Gemini's **Patch Plan** JSON back into the textarea.
5. Click **Apply JSON patch**.

Example Gemini response shape:

```json
{
  "schemaVersion": "bridge-ui-patch-plan/0.1",
  "operations": [
    {
      "type": "create_shell",
      "title": "School portal",
      "slots": [
        { "id": "primary-actions", "title": "Start here" },
        { "id": "main-content", "title": "Main information" },
        { "id": "secondary-content", "title": "More" }
      ]
    },
    {
      "type": "reference_node",
      "selector": "a.login",
      "slot": "primary-actions",
      "label": "Login"
    },
    {
      "type": "move_node",
      "selector": "ul.notice-list",
      "slot": "main-content",
      "label": "Notices"
    }
  ],
  "preservationNotes": [
    "The login link remains in its original page context and is exposed through a shell action."
  ],
  "riskySelectors": []
}
```

## Load in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `/Users/ejunpark/Documents/brigde_hakerthon`.
5. Open a normal web page, click the extension, then click **Extract current page**.
6. Use the staged request buttons to prepare Gemini input, or **Apply demo patch** to test live DOM patching immediately.

Chrome blocks extensions from injecting scripts into internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages. Test on regular `http://` or `https://` pages.

## Snapshot contents

The JSON includes page metadata, viewport geometry, and all matching landmarks, headings, text blocks, interactive elements, form metadata, links, images, media, tables, lists, dialogs, and live regions found by the extractor. When enabled, it also includes a visible viewport screenshot as a PNG data URL.

## Gemini redesign contract

See `docs/gemini-ui-patch-api.md` for the suggested API contract for asking Gemini to simplify page presentation safely. The key rule is that Gemini should return shell operations, not a regenerated HTML page: use `reference_node` for interactive controls, `move_node` only for non-interactive content, and keep original buttons, links, inputs, forms, and site JavaScript behavior intact.

## Regenerated page

The simplified Coupang product page lives in `regenerated/`.

```sh
python3 -m http.server 8080
```

Then open `http://localhost:8080/regenerated/`. The page loads `downloaded_json/coupang galaxy phone.json` and rebuilds the product gallery, search/filtering, quantity controls, cart modal, buy modal, recommendation rows, reviews, product Q&A, and delivery/return sections from the Page Snapshot.

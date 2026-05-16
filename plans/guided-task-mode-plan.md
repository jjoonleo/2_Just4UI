# Guided Task Mode Plan

## Goal

Pivot the project from rebuilding simplified pages to **Guided Task Mode**: a Chrome extension flow where the user enters a task, the extension extracts a Page Snapshot, a model creates a strict Guidance Plan, and an overlay guides the user through the original page without taking actions for them.

## Context

- The current repo already supports **User-Triggered Extraction** through `popup.js`.
- `popup.js` collects a **Page Snapshot** with page metadata, viewport geometry, landmarks, headings, text blocks, interactive elements, forms, links, images, media, tables, lists, dialogs, and live regions.
- The current regenerated page in `regenerated/` proves that Page Snapshot data can drive a new UI, but it is page-specific and risks breaking real page behavior if used as the main product direction.
- The pivot keeps the original website as the source of truth for real functionality. The extension adds guidance, highlighting, scrolling, and progress observation.
- `CONTEXT.md` now defines the core language: Guided Task Mode, Guide-Only Assistance, Task Request, Guidance Plan, Guidance Step, Page Target, Target Recovery, Risk Gate, Planning Payload, Plan Contract, and Guidance Session.

## Decisions

- Use **Guided Task Mode** as the product direction, not "simplified UI" or page regeneration.
- Use **Guide-Only Assistance**: the extension may highlight, scroll, explain, and observe; it must not click, type, submit, purchase, delete, or confirm on the user's behalf.
- Start each flow from a user-written **Task Request**. Add **Task Templates** later as convenience shortcuts.
- Use one active **Guidance Session** at a time. Do not add saved plan history or background monitoring in the first version.
- A **Guidance Step** must have one primary **Page Target**. Split multi-action instructions into multiple steps.
- Use **Target Recovery** when a target disappears: re-scan once, attempt to match by evidence, then show a clear target-not-found state.
- Use **Risk Gates** before sensitive or irreversible guidance, such as final checkout, payment, account deletion, submitting personal information, or destructive changes.
- Use an AI/model call in the prototype to create the **Guidance Plan**.
- Send a reduced **Planning Payload**, not the full raw Page Snapshot, and never include form values.
- For the prototype only, call Gemini or OpenAI directly from extension JavaScript using a user-pasted API key stored in `chrome.storage.local`. Do not hardcode or commit an API key.
- The model must return strict JSON matching the **Plan Contract**. The extension must validate it before rendering.
- Backend proxy migration is required before real release because extension-side API keys are exposed to users.

## Proposed Architecture

```text
Popup
  -> user enters Task Request and optional API key
  -> content script extracts Page Snapshot
  -> popup/content script derives Planning Payload
  -> extension calls selected model provider API
  -> model returns Plan Contract JSON
  -> extension validates Guidance Plan
  -> content script renders overlay on original page
  -> user performs each action manually
  -> content script observes progress and advances steps
```

## Planning Payload

Build a reduced payload from the Page Snapshot:

- `page`: title, URL, origin, language, meta description.
- `viewport`: width, height, scroll position, document dimensions.
- `headings`: visible heading text, level, selector, bounds.
- `landmarks`: role, label, text preview, selector, bounds.
- `interactiveElements`: snapshot ID, tag, role, type, label, text, href, disabled, required, checked, expanded, hasPopup, controls, placeholder, selector, bounds.
- `forms`: form metadata and fields without values.
- `links`: text, href, same-origin flag, selector, bounds.
- `images`: only selected metadata such as alt text, displayed size, selector, bounds, and source when useful.
- `textBlocks`: selected visible text blocks, prioritizing main content, labels, headings, and nearby explanatory text.

Exclude:

- Form values.
- Full raw DOM.
- Full Page Snapshot JSON when not needed.
- Visual Snapshot by default.
- Screenshot data unless a later explicit visual-planning mode is added.

## Plan Contract

The model response must be JSON only:

```json
{
  "summary": "Short description of the user's requested task.",
  "assumptions": ["Short assumption if needed."],
  "steps": [
    {
      "id": "step-1",
      "title": "Set quantity",
      "instruction": "Set the quantity to 2.",
      "target": {
        "snapshotId": "interactive-12",
        "kind": "formField",
        "role": "textbox",
        "label": "quantity",
        "text": "",
        "selector": "#quantity",
        "bounds": {
          "x": 100,
          "y": 420,
          "width": 80,
          "height": 40
        }
      },
      "completion": {
        "type": "inputValueEquals",
        "value": "2"
      },
      "risk": "low"
    }
  ]
}
```

Validation rules:

- `summary` must be a string.
- `steps` must be a non-empty array.
- Each step must have `id`, `title`, `instruction`, `target`, `completion`, and `risk`.
- `risk` must be one of `low`, `medium`, `high`.
- High-risk steps must render a Risk Gate before the normal step instruction.
- If the response cannot be parsed or validated, show a clear error and do not render an overlay.

## Target Matching

Use selectors only as one signal. A Page Target should be resolved by weighted evidence:

- Exact `snapshotId` if available in the current extraction.
- CSS selector if it still points to a visible element.
- Role/type match.
- Accessible label match.
- Visible text match.
- Form field name or placeholder match.
- Link `href` match.
- Nearby heading or landmark text.
- Bounds proximity when the page has not significantly shifted.

Target Recovery flow:

1. Try to locate the target from the original step.
2. If missing, re-run extraction on the current page.
3. Try evidence-based matching once.
4. If matched, update the active step target for this Guidance Session.
5. If still missing, show "Target not found" with retry and cancel options.

## Overlay Behavior

The overlay should:

- Dim the page without blocking the target.
- Highlight the current Page Target.
- Scroll the target into view when the step starts.
- Show a compact instruction bubble near the target.
- Provide `Back`, `Next`, `Retry target`, and `End guide` controls.
- Keep text short and action-oriented.
- Never cover the primary Page Target when possible.
- Respect keyboard navigation where feasible.

Progress tracking should observe:

- User clicks on the target.
- Input changes for fields.
- Checkbox/radio state changes.
- URL changes.
- Dialog/modal appearance.
- DOM mutations around the target.

Manual `Next` must always be available for cases where automatic completion detection is uncertain.

## Risk Gates

Render a Risk Gate before high-risk steps. High-risk examples:

- Final checkout or payment.
- Submitting personal information.
- Deleting or canceling an account/order.
- Changing security settings.
- Any irreversible or hard-to-undo action.

Risk Gate behavior:

- Display the possible consequence plainly.
- Require the user to continue manually.
- Do not perform the action.
- Do not hide the original page's own confirmation UI.

## Implementation Steps

1. Add extension state for Task Request, API key presence, active Guidance Plan, current step index, and overlay status.
2. Add popup UI for:
   - Task Request input.
   - API key setup field stored in `chrome.storage.local`.
   - Start Guided Task Mode button.
   - Clear API key button.
3. Extract a Page Snapshot using the existing `collectPageSnapshot` path.
4. Add a `createPlanningPayload(snapshot)` function that trims the snapshot to the reduced model input.
5. Add model-call modules that:
   - Reads the API key from extension storage.
   - Sends the Task Request and Planning Payload to Gemini or OpenAI.
   - Requests JSON-only output.
   - Handles network, authentication, and parse failures.
6. Add a `validateGuidancePlan(value)` function for the Plan Contract.
7. Add a content-script overlay renderer:
   - Highlight target.
   - Instruction bubble.
   - Step controls.
   - Risk Gate state.
8. Add target resolver and Target Recovery:
   - Selector lookup.
   - Evidence-based fallback.
   - One re-scan retry.
9. Add progress observation:
   - Click/input/change listeners.
   - Mutation observer for target container.
   - URL-change detection if feasible.
10. Add graceful failure states:
   - Missing API key.
   - Model failure.
   - Invalid Plan Contract.
   - Target not found.
   - Unsupported Chrome page.
11. Keep `regenerated/` as a demo/reference artifact, but stop treating it as the main simplification path.
12. Update README after implementation to describe Guided Task Mode and prototype API-key limitations.

## Validation

- Load the extension unpacked in Chrome.
- On a normal HTTP/HTTPS page, enter a simple task and confirm the extension creates a Guidance Plan.
- Verify the overlay highlights the intended element and does not break page interaction.
- Verify links, forms, and page buttons still work because the original page remains intact.
- Verify a high-risk task renders a Risk Gate before the sensitive step.
- Verify removing/changing a target triggers Target Recovery once.
- Verify invalid model JSON is rejected with a clear error.
- Verify no API key is committed to the repo.
- Verify Chrome-restricted pages still fail gracefully.

## Open Questions

- Which provider/model pair should the prototype use by default after demo testing?
- Should screenshots ever be allowed in the Planning Payload, or should v1 remain text/structure-only?
- Should common Task Templates be added before or after the first end-to-end Guided Task Mode demo?
- How much progress detection is needed for the hackathon demo versus manual `Next` controls?

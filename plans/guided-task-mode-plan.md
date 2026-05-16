# Guided Task Mode Plan

## Goal

Pivot the project from rebuilding simplified pages to **Guided Task Mode**: a Chrome extension flow where the user enters a task, the extension extracts a Page Snapshot, a model creates a strict Progressive Guidance Plan, and an overlay guides the user through the original page without taking actions for them.

## Context

- The current repo already supports **User-Triggered Extraction** through `popup.js`.
- `popup.js` collects a **Page Snapshot** with page metadata, viewport geometry, landmarks, headings, text blocks, interactive elements, forms, links, images, media, tables, lists, dialogs, and live regions.
- The current regenerated page in `regenerated/` proves that Page Snapshot data can drive a new UI, but it is page-specific and risks breaking real page behavior if used as the main product direction.
- The pivot keeps the original website as the source of truth for real functionality. The extension adds guidance, highlighting, scrolling, and progress observation.
- `CONTEXT.md` now defines the core language: Guided Task Mode, Guide-Only Assistance, Task Request, Task Clarification, Guidance Plan, Guidance Step, Page Target, Target Recovery, Risk Gate, Planning Payload, Plan Contract, Guidance Session, and Page State Change.

## Decisions

- Use **Guided Task Mode** as the product direction, not "simplified UI" or page regeneration.
- Use **Guide-Only Assistance**: the extension may highlight, scroll, explain, and observe; it must not click, type, submit, purchase, delete, or confirm on the user's behalf.
- Start each flow from a user-written **Task Request**. Add **Task Templates** later as convenience shortcuts.
- Use confidence-gated **Task Clarification** inside the **Plan Contract**. Ask one question at a time only when ambiguity would change the guide.
- Use one active **Guidance Session** at a time. Do not add saved plan history or background monitoring in the first version.
- Let the active **Guidance Session** follow the active tab in its original browser window; do not duplicate overlays across tabs or follow into other windows.
- Refresh the active guide when meaningful **Page State Changes** make the current or next instruction potentially stale.
- Detect **Page State Changes** only while a **Guidance Session** is active in the **Session Host Tab**.
- Keep automatic **Plan Refresh** enabled by default for **Page State Changes**, with a session-level pause control.
- A **Guidance Step** must have one primary **Page Target**. Split multi-action instructions into multiple steps.
- Use **Target Recovery** when a target disappears: re-scan once, attempt to match by evidence, then show a clear target-not-found state.
- Use **Risk Gates** before sensitive or irreversible guidance, such as final checkout, payment, account deletion, submitting personal information, or destructive changes.
- Use an AI/model call in the prototype to create the **Guidance Plan**.
- Use a **Progressive Guidance Plan**: request only the current actionable step and at most one preview step, then continue at step boundaries.
- Preserve completed steps as immutable **Completed Step History**. Do not let later model output rewrite or remove completed steps.
- Send a reduced **Planning Payload**, not the full raw Page Snapshot, and never include form values.
- Keep Page State Change refresh structure-only in v1; do not include screenshots unless a later explicit visual mode is added.
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
  -> model returns Plan Contract JSON with guidance or one clarification question
  -> extension validates the response
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
  "status": "ready",
  "question": "",
  "clarifiedTaskRequest": "Set quantity to 2.",
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

- `status` must be `ready` or `needsClarification`.
- `needsClarification` must include one direct `question` and no Guidance Steps.
- `ready` must include a concise `clarifiedTaskRequest`.
- For `ready`, `summary` must be a string.
- For `ready`, `steps` must be a non-empty array with at most two items: the current actionable step plus one optional preview step.
- Each step must have `id`, `title`, `instruction`, `target`, `completion`, and `risk`.
- `risk` must be one of `low`, `medium`, `high`.
- High-risk steps must render a Risk Gate before the normal step instruction.
- The model must not include a field or instruction that marks the task complete.
- When the step window is exhausted, the user chooses whether to request another step or end the guide.
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
- DOM mutations that remove or hide the current target.

Manual `Next` must always be available for cases where automatic completion detection is uncertain.
Text-entry fields should not auto-complete on a generic `inputChanged` event. Use `inputValueEquals` only when an exact expected value is part of the plan; otherwise require manual `Next`.
Only the current step is actionable. A second step may be shown as a non-actionable preview and may change before the user reaches it.

## Progressive Continuation

The model should not generate a full workflow upfront. Initial planning and later refreshes use the same Plan Contract with explicit planner modes: `initial`, `refresh`, and `continueAfterWindowEnded`.

- Return the current actionable **Guidance Step**.
- Optionally return one future preview **Guidance Step**.
- Do not rewrite completed steps.
- Do not duplicate completed, current, or already-previewed steps unless the current page evidence proves the user must repeat them.
- Do not revise the current highlighted step unless its target is missing.
- Do not decide whether the user is done.
- For `continueAfterWindowEnded`, return only additions after completed history and ask one clarification question instead of repeating prior steps when no new useful step is identifiable.
- For `refresh`, repair stale current/future guidance from current page evidence without restarting the guide.

Continuation requests should include:

- Planner mode.
- The Task Request.
- Current page evidence.
- Compact Completed Step History without form values.
- Current step and optional ahead step.
- Compact plan-so-far context tying the completed history, current step, and ahead step together.
- Locked step count.

Completed Step History should preserve non-secret details: step id, title, instruction, target role/label/text/href, completion type, completion mode, and completed timestamp.

## Page State Change Refresh

The overlay should install **Page State Change** detection only while the active guide is mounted in the **Session Host Tab**. Detection should be cleaned up when the guide ends, moves to another tab, or is replaced by a refreshed guide.

Request same-page model refresh only from:

- The current highlighted **Page Target** disappearing, becoming hidden, or being replaced by a re-render.
- The user manually clicking `Next` and the next **Guidance Step** has no detectable **Page Target**.

Suppress refresh for:

- Mutations caused by Bridge-owned overlay, highlight, style, or guide activity UI.
- Ads, cookie banners, chat widgets, unrelated toasts, and other visible noise outside the active task surface.
- Animations, timers, counters, lazy media far away from the current task, and small style/attribute churn.
- Text input changes while the user is actively typing.
- Selection controls, checked states, menus, modals, and same-page route/content changes when the current highlighted target remains present.

Refresh policy:

- Treat DOM mutations as target-availability checks only.
- Debounce and coalesce target-missing candidates before requesting refresh.
- Record step completion before refresh when the same user action both completes the current **Guidance Step** and causes a **Page State Change**.
- Keep the current guide visible in an updating state while the refresh runs.
- Show refresh work as **Guide Activity** while the **Guidance Session** remains active.
- Do not start a second model refresh while one is already running.
- If page changes happen during a running refresh, queue one follow-up refresh after the current one finishes.
- Add a short cooldown after rendering a refreshed guide so overlay DOM updates do not trigger another refresh.
- Cap refresh frequency so unstable pages cannot create an AI-call loop.

The refreshed **Planning Payload** must keep the same privacy boundary as the original model request: send visible structure, roles, labels, selected/checked state, page URL, and form metadata, but not user-entered form values.

The refreshed **Guidance Plan** should continue from the latest **Session State**. It may omit completed **Guidance Steps** from the visible guide while completed step history remains in **Session State**.

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

1. Add extension state for Task Request, API key presence, active Progressive Guidance Plan, current step index, Completed Step History, and overlay status.
2. Add popup UI for:
   - Task Request input.
   - API key setup field stored in `chrome.storage.local`.
   - Start Guided Task Mode button.
   - Clear API key button.
3. Extract a Page Snapshot using the existing `collectPageSnapshot` path.
4. Add a `createPlanningPayload(snapshot)` function that trims the snapshot to the reduced model input.
5. Add model-call modules that:
   - Reads the API key from extension storage.
   - Returns either confident guidance or one Task Clarification question from the same Plan Contract.
   - Sends the Task Request, Planning Payload, and progressive continuation context to Gemini or OpenAI.
   - Requests JSON-only output.
   - Handles network, authentication, and parse failures.
6. Add a `validateGuidancePlan(value)` function for the Plan Contract.
   - Reject plans that include more than the current actionable step plus one optional preview step.
   - Do not validate or require any model-provided done rule.
7. Add a content-script overlay renderer:
   - Highlight target.
   - Instruction bubble.
   - Step controls.
   - Risk Gate state.
   - Non-actionable preview state.
8. Add target resolver and Target Recovery:
   - Selector lookup.
   - Evidence-based fallback.
   - One re-scan retry.
9. Add progress observation:
   - Click/input/change listeners.
   - Mutation observer for target container.
   - URL-change detection if feasible.
10. Add Page State Change refresh:
   - Install the watcher from the active overlay, not as a permanent content script.
   - Detect target disappearance and missing next-step targets.
   - Debounce/coalesce target-missing changes before requesting refresh.
   - Ignore Bridge-owned DOM and visible noise outside the active task surface.
   - Preserve progress and completed step history when requesting a refreshed plan.
   - Queue one follow-up refresh when a page changes while a refresh is already running.
   - Add a session-level control to pause automatic refresh.
11. Add graceful failure states:
   - Missing API key.
   - Model failure.
   - Invalid Plan Contract.
   - Target not found.
   - Unsupported Chrome page.
12. Add multi-tab session movement:
   - Store the Session Window and current Session Host Tab.
   - Move the host only on active-tab change, not background-tab creation.
   - Remove the old overlay before refreshing the guide on the new host tab.
   - Preserve completed step history while resetting the refreshed page-specific step index.
13. Keep `regenerated/` as a demo/reference artifact, but stop treating it as the main simplification path.
14. Update README after implementation to describe Guided Task Mode and prototype API-key limitations.

## Validation

- Load the extension unpacked in Chrome.
- On a normal HTTP/HTTPS page, enter a simple task and confirm the extension creates a Guidance Plan.
- Verify ambiguous Task Requests show one clarification question instead of rendering a guide.
- Verify the guide starts with the Clarified Task Request after the Plan Contract returns `ready`.
- Verify the first model response contains only the current actionable step plus at most one preview step.
- Verify completed steps are preserved in Completed Step History and are not rewritten by later model output.
- Verify future preview steps can change before the user reaches them.
- Verify the overlay highlights the intended element and does not break page interaction.
- Verify links, forms, and page buttons still work because the original page remains intact.
- Verify a high-risk task renders a Risk Gate before the sensitive step.
- Verify the guide does not complete merely because the last planned step was exhausted.
- Verify the exhausted step window asks the user whether to request another step or end the guide.
- Verify no model-provided done rule can automatically end the guide.
- Verify timeout, refresh failure, unsupported navigation, host-tab closure, and Session Window closure do not end the guide.
- Verify opening a menu, dropdown, popover, dialog, or modal does not trigger Plan Refresh while the highlighted target remains present.
- Verify SPA route changes do not trigger Plan Refresh unless the highlighted target disappears.
- Verify Bridge overlay rerenders do not trigger another Plan Refresh.
- Verify active typing in text inputs does not trigger automatic Plan Refresh.
- Verify selection controls, checked states, and opened option lists do not trigger Plan Refresh while the highlighted target remains present.
- Verify a failed Page State Change refresh keeps the previous guide usable when possible.
- Verify automatic Page State Change refresh can be paused for the current Guidance Session.
- Verify switching tabs in the same browser window moves the guide to the active tab and removes the old overlay.
- Verify switching Chrome windows does not move the guide out of its original window.
- Verify removing/changing a target triggers Target Recovery once.
- Verify invalid model JSON is rejected with a clear error.
- Verify no API key is committed to the repo.
- Verify Chrome-restricted pages still fail gracefully.

## Open Questions

- Which provider/model pair should the prototype use by default after demo testing?
- Should common Task Templates be added before or after the first end-to-end Guided Task Mode demo?

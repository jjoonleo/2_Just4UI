# Browser Page Assistance

This context describes the language for a Chrome extension that helps make browser pages easier to understand and use.

## Language

**Page Snapshot**:
A structured representation of the current browser page collected for analysis.
_Avoid_: Raw page dump, scrape result, extracted data

**User-Triggered Extraction**:
A collection flow that starts only after the user intentionally asks the extension to inspect the current page.
_Avoid_: Automatic scraping, background extraction

**Form Metadata**:
The non-secret description of a form field, such as its label, type, placeholder, requirement state, and visibility.
_Avoid_: Form values, typed input, submitted data

**Visual Snapshot**:
An optional screenshot of the visible browser viewport captured with the user's consent.
_Avoid_: Silent screenshot, full-page recording

**One-Time Result**:
A Page Snapshot that is shown to the user without being automatically retained by the extension.
_Avoid_: Snapshot history, background archive

**Local Extraction**:
The first milestone where Page Snapshots are produced and inspected locally before any model receives them.
_Avoid_: Immediate model call, automatic AI processing

**Guided Task Mode**:
A user-requested assistance flow that guides the user through a task on the original page without replacing the page's own interface.
_Avoid_: Simplified UI, regenerated page, automatic task execution

**Guide-Only Assistance**:
A Guided Task Mode boundary where the extension explains, highlights, scrolls, and observes while the user performs every page action.
_Avoid_: Auto-clicking, auto-typing, auto-submit

**Task Request**:
A user-written description of what the user wants to accomplish on the current page.
_Avoid_: Command, automation prompt, saved workflow

**Task Clarification**:
A one-question-at-a-time interview used when the next useful guidance cannot be chosen with enough confidence.
_Avoid_: Full planning, generic chat, optional preference survey

**Clarified Task Request**:
The sharpened Task Request produced after Task Clarification has enough information for guide planning.
_Avoid_: Raw ambiguous request, hidden assumption, model-only intent

**Task Template**:
A reusable suggested Task Request for a common page goal.
_Avoid_: Required workflow, hardcoded site script

**Guidance Step**:
One instruction in Guided Task Mode tied to one primary target on the original page.
_Avoid_: Multi-action instruction, automation step, script command

**Page Target**:
The original page element a Guidance Step points the user toward.
_Avoid_: Permanent selector, copied DOM node

**Target Recovery**:
A one-time re-scan of the current page to find a Page Target again after the page changes.
_Avoid_: Silent retargeting, infinite retry

**Risk Gate**:
A warning boundary in Guided Task Mode before sensitive or irreversible user actions.
_Avoid_: Silent final action, hidden confirmation, automatic purchase

**Guidance Plan**:
A sequence of Guidance Steps created for one Task Request on one current page.
_Avoid_: Browser automation script, regenerated page

**Progressive Guidance Plan**:
A Guidance Plan that starts with immediate next guidance and grows as the user asks for more guidance.
_Avoid_: Full script, complete upfront workflow, rewritten history

**Guidance Continuation**:
An addition or revision that extends only the not-yet-completed part of a Progressive Guidance Plan.
_Avoid_: Full replacement plan, rewritten completed steps, history edit

**Completed Step History**:
The immutable session record of Guidance Steps the user has already completed or passed.
_Avoid_: Editable past steps, form values, model-rewritten history

**Navigation Completion**:
A Guidance Step completion caused by the user activating the highlighted Page Target and that activation navigating the current tab or moving the Guidance Session to another active tab within a five-second handoff window.
_Avoid_: Background tab opening, unrelated tab switch, automatic page load

**Planning Payload**:
A reduced Page Snapshot view sent to a model for creating a Guidance Plan.
_Avoid_: Full raw snapshot, form values, default screenshot upload

**Plan Contract**:
The required structured shape of a Guidance Plan returned by a model.
_Avoid_: Free-form model answer, unvalidated instructions, separate clarification gate

**Guidance Session**:
The one active Guided Task Mode run the user is currently following.
_Avoid_: Saved plan history, background monitor, multi-plan queue

**Navigating Guidance Session**:
A Guidance Session that continues as the user moves between pages or active tabs in the same browser window.
_Avoid_: All-tabs guide, simultaneous tab overlays, saved workflow

**Plan Refresh**:
An update to a Guidance Plan after navigation or active-tab change using the new page evidence.
_Avoid_: Reusing stale selectors, starting over silently

**Page State Change**:
A user-visible change inside the current Session Host Tab during an active Guidance Session that may make the current Guidance Plan stale.
_Avoid_: Hidden mutation, background monitoring, automatic scraping

**Session State**:
The minimal information needed to continue a Guidance Session after page changes.
_Avoid_: Snapshot history, full-page archive, simultaneous tab memory

**Session Status**:
The user-visible lifecycle position of a Guidance Session.
_Avoid_: Generic session flag, hidden internal state, stopped

**Guide Activity**:
A temporary indication that the extension is preparing, creating, refreshing, or presenting guidance for a Guidance Session.
_Avoid_: Session status, background monitor, invisible AI work

**Guide Activity Phase**:
A short user-visible reason why Guide Activity is currently in progress.
_Avoid_: Debug log, internal implementation step, hidden AI request

**Session Dashboard**:
The user-visible view of the current Guidance Session's status and activity.
_Avoid_: Disposable start form, debug console, hidden session state

**Session End**:
The user-controlled action that stops a Guidance Session.
_Avoid_: Automatic expiry, hidden timeout, model-decided completion

**Paused Guidance Session**:
A Guidance Session waiting for a supported page after navigation, active-tab change, extraction failure, or overlay injection failure.
_Avoid_: Silent failure, broken active guide

**Session Host Tab**:
The active browser tab currently displaying the user's one Guidance Session.
_Avoid_: All guide tabs, copied guide, background tab overlay

**Session Window**:
The browser window that owns a Navigating Guidance Session.
_Avoid_: Any Chrome window, global browser scope, profile-wide guide

## Relationships

- A **Page Snapshot** represents exactly one current browser page at one point in time.
- **User-Triggered Extraction** produces one **Page Snapshot** for the active browser page.
- A **Page Snapshot** may include **Form Metadata** but not user-entered form values.
- A **Page Snapshot** may include one **Visual Snapshot** when the user explicitly enables screenshot capture.
- A **Page Snapshot** is a **One-Time Result** unless the user explicitly copies or downloads it.
- **Local Extraction** produces **Page Snapshots** without sending them to a model.
- **Guided Task Mode** uses a **Page Snapshot** to guide the user on the original browser page.
- **Guide-Only Assistance** keeps page actions under the user's direct control.
- A **Task Request** starts one **Guided Task Mode** flow.
- A **Task Clarification** should happen only when the next useful **Guidance Step** cannot be chosen with enough confidence.
- A **Task Clarification** should ask exactly one question when ambiguity would change which **Page Target** or action should be guided next.
- A **Task Clarification** should not ask optional preference questions that are not needed for the next useful guidance.
- A **Task Clarification** may use current page evidence to identify missing target, action, object, amount, account, recipient, or constraint details.
- Missing user-entered input values should not trigger **Task Clarification** when the correct **Page Target** is identifiable.
- When a required value is missing but the correct input **Page Target** is identifiable, the **Guidance Step** should highlight the input field and let the user choose the value.
- Multiple plausible **Page Targets** should trigger **Task Clarification** only when they represent meaningfully different user outcomes.
- Equivalent duplicate **Page Targets** for the same action should not trigger **Task Clarification**; the guide may choose the visible primary target.
- A **Clarified Task Request** should be used as the input to **Guidance Plan** creation.
- A **Task Clarification** should not create **Guidance Steps**.
- A **Guidance Plan** may be created without **Task Clarification** when the current page evidence and **Task Request** identify the next useful **Guidance Step** with enough confidence.
- A **Task Template** may prefill a **Task Request**.
- A **Guidance Step** points to one primary page target.
- A **Page Target** is matched from page evidence such as role, label, text, location, and selector.
- **Target Recovery** may update a **Page Target** once when the original match is missing.
- A **Risk Gate** may appear before a **Guidance Step** that involves sensitive or irreversible consequences.
- A **Guidance Plan** is created from one **Task Request** and one **Page Snapshot**.
- A **Guidance Plan** contains one or more **Guidance Steps**.
- A **Progressive Guidance Plan** should add guidance as the user progresses instead of generating the full task flow upfront.
- A **Progressive Guidance Plan** should size its active generated window by planner mode.
- Model output for a **Progressive Guidance Plan** should contain only the active generated window from the current point, not the whole plan or completed history.
- `initial` and `continueAfterWindowEnded` model output should contain the current actionable **Guidance Step** and at most one future **Guidance Step**.
- `refresh` model output should contain all task-relevant not-yet-completed **Guidance Steps** possible on the current page, up to the refresh step cap.
- `refresh` model output should ignore unrelated visible controls that do not advance the **Task Request**.
- A **Progressive Guidance Plan** should request additional guidance at step boundaries rather than during ordinary user interaction.
- A **Guidance Continuation** may add or revise only not-yet-completed **Guidance Steps**.
- Completed **Guidance Steps** should not be modified or removed from a **Progressive Guidance Plan**.
- Model prompts should strictly state that completed **Guidance Steps** are immutable locked history and must not be modified, renamed, reordered, reinterpreted, removed, downgraded, or returned as current/not-completed.
- **Completed Step History** should preserve enough non-secret step detail to show what was completed without retaining user-entered form values.
- **Completed Step History** should be append-only for a **Guidance Session**; completed guide entries should not be removed, truncated, downgraded, or overwritten by refresh output.
- A completed guide entry's state is strict and non-editable; it must never become current or not-completed again.
- A refreshed **Guidance Plan** should drop any returned **Guidance Step** that matches **Completed Step History** before it is saved or rendered.
- **Completed Step History** may be summarized for the model but should not be replaced by future model output.
- A **Guidance Continuation** request should include compact plan-so-far context: **Completed Step History**, current page evidence, the current **Guidance Step**, and not-yet-reached future steps.
- A **Guidance Continuation** should use plan-so-far context to avoid creating duplicate completed, current, or already-previewed **Guidance Steps**.
- A **Guidance Continuation** request should not include old full **Page Snapshots** by default.
- The current highlighted **Guidance Step** should remain stable unless its **Page Target** disappears or cannot be found.
- A **Guidance Continuation** should not revise the current highlighted **Guidance Step** unless its **Page Target** is missing.
- Future **Guidance Steps** may be added or revised before the user reaches them.
- In a **Progressive Guidance Plan**, only the current **Guidance Step** is actionable.
- A future **Guidance Step** may be shown as a non-actionable preview and may change before the user reaches it.
- A **Guidance Plan** should not decide when a **Guidance Session** is complete.
- A **Guidance Session** should end only when the user explicitly ends it or starts a replacement **Guidance Session**.
- When a **Guidance Plan** has no remaining **Guidance Steps**, the user should choose whether to request **Guidance Continuation** or end the **Guidance Session**.
- For sensitive or final-action targets, a **Guidance Step** may highlight the final **Page Target**, but the user still decides whether to act or end the guide.
- A **Planning Payload** is derived from a **Page Snapshot** without form values.
- A **Planning Payload** created after a **Page State Change** keeps the same privacy boundary as the original **Planning Payload**.
- A **Plan Contract** makes a **Guidance Plan** predictable enough for the extension to render.
- Initial planning and **Guidance Continuation** should use one **Plan Contract**, with empty **Completed Step History** for the first request.
- A **Plan Contract** request should include a planner mode: `initial`, `refresh`, or `continueAfterWindowEnded`.
- `continueAfterWindowEnded` should be addition-only after the exhausted generated guide window and should ask one **Task Clarification** rather than repeating prior steps when no new useful step is identifiable.
- The **Plan Contract** should return either confident guidance or one **Task Clarification** question.
- **Task Clarification** should be part of the **Plan Contract**, not a separate preflight model call.
- A **Guidance Session** follows one **Guidance Plan** at a time.
- A **Guidance Session** should not be considered complete only because the current **Guidance Plan** has no remaining **Guidance Steps**.
- Starting a new **Guidance Session** replaces any existing **Guidance Session**.
- A replacement **Guidance Session** should not remove the existing **Guidance Session** until the new **Guidance Plan** is ready.
- A **Navigating Guidance Session** may use multiple **Page Snapshots** as the user moves through pages or active tabs in one browser window.
- A **Plan Refresh** uses the latest **Page Snapshot** to continue a **Navigating Guidance Session**.
- A **Plan Refresh** happens when the **Session Host Tab** changes.
- A **Plan Refresh** should use planner mode `refresh`, not `initial`, so it cannot restart the guide.
- A **Page State Change** may trigger a **Plan Refresh** when visible page evidence changes during an active **Guidance Session**.
- **Page State Change** detection should be active only during an active or refreshing **Guidance Session** in the **Session Host Tab**.
- Automatic **Plan Refresh** from meaningful **Page State Changes** should be enabled by default for a **Guidance Session** and pausable by the user for that session.
- When the same user action completes a **Guidance Step** and causes a **Page State Change**, the step completion should be recorded before **Plan Refresh**.
- A **Plan Refresh** request triggered by the same user action that completes a **Guidance Step** should carry that completed step record in the refresh message so request ordering cannot make the completed step appear current again.
- A **Page State Change** is meaningful when it changes the visible task surface enough that the current or next **Guidance Step** may be stale.
- A **Plan Refresh** should happen only after the visible task surface actually changes.
- Layout-only movement should not count as a **Page State Change** unless it changes the usable task surface.
- A **Page State Change** should not include visual noise that does not affect the visible task surface.
- A same-page **Plan Refresh** should be limited to cases where the current highlighted **Page Target** disappears or the user manually advances to a **Guidance Step** whose **Page Target** cannot be found.
- Text input changes may update **Guidance Step** progress but should not trigger automatic **Plan Refresh** while the user is actively typing.
- Text input changes should not automatically complete a **Guidance Step** unless the expected text value is explicit.
- A **Navigation Completion** should record the completed **Guidance Step** before the related **Plan Refresh**.
- A **Navigation Completion** may be accepted from the previous **Session Host Tab** after the session host has moved, when the completed step came from the highlighted **Page Target** that caused the move.
- A **Navigation Completion** should apply only when the user action navigates the current tab or moves the **Guidance Session** to an active tab; opening a background tab alone should not complete the step.
- A **Navigation Completion** from the previous **Session Host Tab** should be accepted only within a five-second completion handoff window.
- A **Navigation Completion** from the previous **Session Host Tab** should require a completed step record from the highlighted **Page Target**; a bare progress index should not be accepted.
- Selection controls, checked states, menus, modals, and same-page route or content changes should not trigger **Plan Refresh** unless they make the current highlighted **Page Target** disappear.
- Multiple nearby **Page State Changes** should be treated as one reason for **Plan Refresh** after the visible task surface settles.
- A **Plan Refresh** should not trigger another **Plan Refresh** from the extension's own guide updates.
- **Target Recovery** should be used when the current **Guidance Step** is still valid but its **Page Target** needs to be found again.
- **Plan Refresh** should be used when a **Page State Change** makes the current or next **Guidance Step** potentially stale.
- A **Plan Refresh** caused by a **Page State Change** should preserve **Session State** while replacing stale page-specific **Guidance Steps**.
- A refreshed **Guidance Plan** may omit completed **Guidance Steps** from the visible guide while **Session State** preserves completed step history.
- **Session State** preserves progress without retaining old full Page Snapshots by default.
- **Session State** preserves completed step history across **Plan Refresh**.
- **Session Status** tells the user whether the **Guidance Session** has no guide, is planning, active, paused, ended, or failed.
- **Guide Activity** may appear while the extension extracts page evidence, creates or refreshes a **Guidance Plan**, or updates the visible guidance.
- **Guide Activity Phase** explains the current **Guide Activity**.
- **Guide Activity** does not replace **Session Status**.
- A **Plan Refresh** caused by a **Page State Change** should appear as **Guide Activity** while the **Guidance Session** remains active.
- Failed **Guide Activity** does not make a **Guidance Session** failed when the current **Guidance Plan** can still continue.
- During a **Plan Refresh**, the page guide should be removed while the refresh request is ongoing and shown again only after refreshed guidance is ready.
- During a **Plan Refresh**, the **Session Dashboard** should also hide the generated guide and current step until the refresh request finishes.
- A failed **Plan Refresh** caused by a **Page State Change** should keep the previous **Guidance Plan** available when it can still continue.
- A **Session Dashboard** presents the current **Session Status** and **Guide Activity** for the **Guidance Session**.
- A **Session Dashboard** may present the **Task Request**, current **Guidance Step**, and latest pause or failure reason.
- A **Session Dashboard** should show the generated guide so far with each step's completed, current, or not-completed state.
- A **Session Dashboard** may be reopened without losing the current **Guidance Session** view.
- A **Session Dashboard** may let the user end an active or paused **Guidance Session**.
- A **Guidance Session** should not end because of timeout, unsupported navigation, closed host tab, closed Session Window, refresh failure, or exhausted steps.
- A **Paused Guidance Session** may resume on the next supported page in the same Session Window.
- A **Guidance Session** has at most one **Session Host Tab** at a time.
- A **Navigating Guidance Session** belongs to exactly one **Session Window**.
- A background tab does not become the **Session Host Tab** until the user activates it.
- Any supported active tab in the **Session Window** may become the **Session Host Tab**.
- Closing the **Session Host Tab** may move the session to another active tab in the **Session Window**.

## Example dialogue

> **Dev:** "Should Gemini receive the raw HTML?"
> **Domain expert:** "No — Gemini should receive a **Page Snapshot** that captures the useful page content and interaction points."
>
> **Dev:** "When should we create a **Page Snapshot**?"
> **Domain expert:** "Only through **User-Triggered Extraction**, when the user asks for help on the current page."
>
> **Dev:** "Should the **Page Snapshot** include what the user typed into a form?"
> **Domain expert:** "No — include **Form Metadata**, not user-entered values."
>
> **Dev:** "Should every **Page Snapshot** include a screenshot?"
> **Domain expert:** "No — a **Visual Snapshot** is optional and off by default."
>
> **Dev:** "Should we keep a history of **Page Snapshots**?"
> **Domain expert:** "No — each **Page Snapshot** is a **One-Time Result** unless the user saves it."
>
> **Dev:** "Should we call Gemini as soon as extraction works?"
> **Domain expert:** "No — start with **Local Extraction** so we can inspect the **Page Snapshot** shape first."
>
> **Dev:** "Should the extension rebuild the page into a simpler version?"
> **Domain expert:** "No — use **Guided Task Mode** to guide the user on the original page so the page's own behavior remains intact."
>
> **Dev:** "Can **Guided Task Mode** click the buy button for the user?"
> **Domain expert:** "No — **Guide-Only Assistance** may point to the button, but the user must perform the action."
>
> **Dev:** "Should users choose only from predefined tasks?"
> **Domain expert:** "No — the user should be able to enter a **Task Request**, while **Task Templates** can help with common goals later."
>
> **Dev:** "Can one **Guidance Step** ask the user to choose quantity, add to cart, and confirm?"
> **Domain expert:** "No — split that into separate **Guidance Steps** so each step has one primary target."
>
> **Dev:** "Should a missing target make the guide fail immediately?"
> **Domain expert:** "No — try **Target Recovery** once, then show a clear target-not-found state if the target still cannot be matched."
>
> **Dev:** "Can **Guided Task Mode** guide the user to final checkout?"
> **Domain expert:** "Yes, but use a **Risk Gate** so the user understands the sensitive consequence before acting."
>
> **Dev:** "Does **Guided Task Mode** stay local only?"
> **Domain expert:** "No — after **Local Extraction** proves the Page Snapshot shape, **Guided Task Mode** may use a model to create a **Guidance Plan**."
>
> **Dev:** "Should the model receive the full JSON result?"
> **Domain expert:** "No — send a **Planning Payload** with only the page evidence needed to create a **Guidance Plan**."
>
> **Dev:** "Can the model return normal prose?"
> **Domain expert:** "No — it must return a **Plan Contract** so **Guided Task Mode** can render and track each step."
>
> **Dev:** "Can the user keep multiple saved plans running?"
> **Domain expert:** "No — one **Guidance Session** follows one **Guidance Plan** at a time."
>
> **Dev:** "Should the guide continue if the user moves to another page?"
> **Domain expert:** "Yes, a **Navigating Guidance Session** should continue across pages and active tabs in the same browser window."
>
> **Dev:** "Should the old plan be reused after navigation?"
> **Domain expert:** "No — use **Plan Refresh** so the guide is based on the new page evidence."
>
> **Dev:** "Should the extension keep every Page Snapshot from the journey?"
> **Domain expert:** "No — keep only **Session State** and extract a fresh **Page Snapshot** after navigation."
>
> **Dev:** "Should a guide resume forever until manually removed?"
> **Domain expert:** "Yes — keep the **Guidance Session** until the user explicitly ends it or starts a replacement guide."
>
> **Dev:** "Should unsupported pages immediately end a guide?"
> **Domain expert:** "No — make it a **Paused Guidance Session** until the user ends it or starts a replacement guide."
>
> **Dev:** "Should a restricted page keep showing the previous tab's guide?"
> **Domain expert:** "No — the stale overlay should be removed, while the **Paused Guidance Session** waits for a supported page."
>
> **Dev:** "Should the guide stay visible in the old tab after the user switches tabs?"
> **Domain expert:** "No — the **Session Host Tab** moves to the newly active tab, so the old tab should no longer show the guide."
>
> **Dev:** "Should the guide follow the user into another Chrome window?"
> **Domain expert:** "No — a **Navigating Guidance Session** stays inside its **Session Window**."
>
> **Dev:** "Should a background tab opened by a link immediately receive the guide?"
> **Domain expert:** "No — only the active tab can become the **Session Host Tab**."
>
> **Dev:** "Should a host-tab change reuse the previous plan if the URL looks similar?"
> **Domain expert:** "No — use **Plan Refresh** with a fresh **Page Snapshot** whenever the **Session Host Tab** changes."
>
> **Dev:** "Should the guide ignore an unrelated supported tab?"
> **Domain expert:** "No — any supported active tab in the **Session Window** can become the **Session Host Tab**."
>
> **Dev:** "Should a refreshed guide keep completed step history?"
> **Domain expert:** "Yes — preserve completed step history in **Session State**, but restart numbering for the refreshed page-specific **Guidance Plan**."
>
> **Dev:** "Can the user start a second guide while one is already active?"
> **Domain expert:** "No — starting a new **Guidance Session** replaces the existing one and removes its old overlay."
>
> **Dev:** "Should closing the current host tab end the guide?"
> **Domain expert:** "No — if the **Session Window** still has an active tab, the guide should move there and refresh."

## Flagged ambiguities

- "Extract useful data" was resolved as producing a **Page Snapshot** for the first milestone.
- "Simplified UI" was resolved as **Guided Task Mode** for the pivoted direction.
- "Keep functions working" was resolved by keeping page actions under **Guide-Only Assistance** instead of automatic execution.
- "Preentered task" was resolved as a user-written **Task Request**, with **Task Templates** as optional later helpers.
- "Step" was resolved as a **Guidance Step** with one primary page target.
- "Selected DOM" was resolved as a **Page Target** that can be recovered once after page changes.
- "Sensitive actions" were resolved as allowed guidance only when protected by a **Risk Gate**.
- "AI call" was resolved as model-assisted creation of a **Guidance Plan** after **Local Extraction**.
- "Model input" was resolved as a reduced **Planning Payload**, not the full raw Page Snapshot.
- "Model output" was resolved as a strict **Plan Contract**, not free-form instructions.
- "Active guide" was resolved as one **Guidance Session** at a time, without plan history.
- "Starting a new guide" was resolved as replacing the existing **Guidance Session**, not creating a second active session.
- "Preserved if user move to other page" was resolved as a **Navigating Guidance Session**.
- "Persistent throughout multiple tabs" was resolved as one **Navigating Guidance Session** following the active tab in the same browser window, not simultaneous overlays in every tab.
- "Multiple tabs" was resolved as one moving **Session Host Tab**, not duplicated guide overlays.
- "Multiple windows" was resolved as out of scope for one **Navigating Guidance Session**.
- "Background tabs" were resolved as inactive until explicitly activated by the user.
- "Host-tab change" was resolved as a **Plan Refresh** boundary, not an existing-plan reuse case.
- "Unrelated active tabs" were resolved as eligible **Session Host Tabs**.
- "Completed steps across tabs" were resolved as preserved **Session State** with refreshed page-specific step numbering.
- "Closing the host tab" was resolved as a host move within the **Session Window** when possible, not an automatic **Session End**.
- "Continue on a new page" was resolved as **Plan Refresh**, not stale-plan reuse.
- "What survives navigation" was resolved as minimal **Session State**, not old full Page Snapshots.
- "How long persistence lasts" was resolved as until explicit **Session End** or replacement by a new **Guidance Session**.
- "Multi-tab expiry" was rejected; host-tab closure, Session Window closure, repeated refresh failure, and TTL should not end the **Guidance Session**.
- "Unsupported navigation" was resolved as a **Paused Guidance Session** until the user ends or replaces it.
- "Unsupported active tab" was resolved as a **Paused Guidance Session** with no stale overlay.

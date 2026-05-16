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

**Planning Payload**:
A reduced Page Snapshot view sent to a model for creating a Guidance Plan.
_Avoid_: Full raw snapshot, form values, default screenshot upload

**Plan Contract**:
The required structured shape of a Guidance Plan returned by a model.
_Avoid_: Free-form model answer, unvalidated instructions

**Guidance Session**:
The one active Guided Task Mode run the user is currently following.
_Avoid_: Saved plan history, background monitor, multi-plan queue

**Navigating Guidance Session**:
A Guidance Session that continues as the user moves between pages or active tabs in the same browser window.
_Avoid_: All-tabs guide, simultaneous tab overlays, saved workflow

**Plan Refresh**:
An update to a Guidance Plan after navigation or active-tab change using the new page evidence.
_Avoid_: Reusing stale selectors, starting over silently

**Session State**:
The minimal information needed to continue a Guidance Session after page changes.
_Avoid_: Snapshot history, full-page archive, simultaneous tab memory

**Session Expiry**:
The conditions that end a Guidance Session so it cannot unexpectedly resume later.
_Avoid_: Indefinite guide, hidden background continuation

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
- A **Task Template** may prefill a **Task Request**.
- A **Guidance Step** points to one primary page target.
- A **Page Target** is matched from page evidence such as role, label, text, location, and selector.
- **Target Recovery** may update a **Page Target** once when the original match is missing.
- A **Risk Gate** may appear before a **Guidance Step** that involves sensitive or irreversible consequences.
- A **Guidance Plan** is created from one **Task Request** and one **Page Snapshot**.
- A **Guidance Plan** contains one or more **Guidance Steps**.
- A **Planning Payload** is derived from a **Page Snapshot** without form values.
- A **Plan Contract** makes a **Guidance Plan** predictable enough for the extension to render.
- A **Guidance Session** follows one **Guidance Plan** at a time.
- Starting a new **Guidance Session** replaces any existing **Guidance Session**.
- A **Navigating Guidance Session** may use multiple **Page Snapshots** as the user moves through pages or active tabs in one browser window.
- A **Plan Refresh** uses the latest **Page Snapshot** to continue a **Navigating Guidance Session**.
- A **Plan Refresh** happens when the **Session Host Tab** changes.
- **Session State** preserves progress without retaining old full Page Snapshots by default.
- **Session State** preserves completed step history across **Plan Refresh**.
- **Session Expiry** ends stale or failed **Guidance Sessions**.
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
> **Domain expert:** "No — use **Session Expiry** when the user ends it, starts a new guide, the Session Window closes, refresh fails repeatedly, or the session becomes stale."
>
> **Dev:** "Should unsupported pages immediately end a guide?"
> **Domain expert:** "No — make it a **Paused Guidance Session** once, then expire it if refresh keeps failing."
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
- "Closing the host tab" was resolved as a host move within the **Session Window**, not immediate **Session Expiry**.
- "Continue on a new page" was resolved as **Plan Refresh**, not stale-plan reuse.
- "What survives navigation" was resolved as minimal **Session State**, not old full Page Snapshots.
- "How long persistence lasts" was resolved as bounded by **Session Expiry**.
- "Multi-tab expiry" was resolved as explicit end, new guide replacement, Session Window closure, repeated refresh failure, or TTL.
- "Unsupported navigation" was resolved as a **Paused Guidance Session** before expiry.
- "Unsupported active tab" was resolved as a **Paused Guidance Session** with no stale overlay.

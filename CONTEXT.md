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

**AI Patch Request**:
A model input derived from a Page Snapshot that asks for presentation-only page changes.
_Avoid_: Raw HTML prompt, page regeneration prompt

**AI Patch Workflow**:
A staged model-assisted flow that turns one Page Snapshot into one validated Patch Plan.
_Avoid_: One-shot redesign, automatic AI pipeline

**Page Analysis**:
A model-produced interpretation of page type, primary tasks, critical content, and Preserved Interactive Nodes.
_Avoid_: Final design, patch output

**Simplification Strategy**:
A model-produced presentation direction that guides a Patch Plan without directly changing the page.
_Avoid_: CSS patch, implementation plan

**Patch Repair Request**:
A model input derived from a rejected Patch Plan and local validation errors.
_Avoid_: AI safety approval, trusted validation

**Patch Plan**:
A selector-based set of CSS and safe DOM presentation operations returned by a model.
_Avoid_: Generated page, replacement HTML

**Live UI Patch**:
A presentation layer applied to the currently loaded browser page without rebuilding the page.
_Avoid_: Full regeneration, page clone

**Simplified Shell**:
A task-first presentation surface that reorganizes original page nodes into a smaller interface.
_Avoid_: Replacement page, regenerated UI

**Shell Slot**:
A named region inside a Simplified Shell where original page nodes can be placed by task priority.
_Avoid_: Generated card, fake control

**Original Node Relocation**:
Moving an existing non-interactive page node into a Shell Slot while preserving it as the same DOM element.
_Avoid_: Clone, copy, recreate

**Original Node Reference**:
A shell action that activates or reveals an original interactive node without moving it out of its page context.
_Avoid_: Fake button, cloned control

**Preserved Interactive Node**:
An original clickable or form element that remains the source of browser behavior.
_Avoid_: Recreated button, cloned control

## Relationships

- A **Page Snapshot** represents exactly one current browser page at one point in time.
- **User-Triggered Extraction** produces one **Page Snapshot** for the active browser page.
- A **Page Snapshot** may include **Form Metadata** but not user-entered form values.
- A **Page Snapshot** may include one **Visual Snapshot** when the user explicitly enables screenshot capture.
- A **Page Snapshot** is a **One-Time Result** unless the user explicitly copies or downloads it.
- **Local Extraction** produces **Page Snapshots** without sending them to a model.
- An **AI Patch Request** is created from one **Page Snapshot** and predefined extension safety rules, and excludes user-entered form values.
- An **AI Patch Workflow** starts from one **Page Snapshot** and ends with at most one applied **Live UI Patch**.
- An **AI Patch Workflow** may ask a model for **Page Analysis**, then a **Simplification Strategy**, then a **Patch Plan**.
- A **Page Analysis** identifies **Preserved Interactive Nodes** before presentation changes are planned.
- A **Simplification Strategy** guides one **Patch Plan**.
- A **Patch Repair Request** may be created after local validation rejects a **Patch Plan**.
- A **Patch Plan** applies one **Live UI Patch** to the current browser page.
- A **Live UI Patch** must keep every **Preserved Interactive Node** as the original source of behavior.
- A **Live UI Patch** may create one **Simplified Shell** for the active page.
- A **Simplified Shell** contains one or more **Shell Slots**.
- **Original Node Relocation** moves non-interactive original nodes into **Shell Slots** without recreating them.
- An **Original Node Reference** activates or reveals a **Preserved Interactive Node** while leaving that node in its original page context.

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
> **Dev:** "Should Gemini return a whole replacement product page?"
> **Domain expert:** "No — Gemini should return a **Patch Plan** for a **Live UI Patch**, and the original purchase buttons remain **Preserved Interactive Nodes**."
>
> **Dev:** "Should the first **AI Patch Workflow** call Gemini directly?"
> **Domain expert:** "No — keep it as a copy/paste staged prototype until the intermediate outputs and validation rules are stable."
>
> **Dev:** "How do we make the page dramatically simpler without breaking login or reservation buttons?"
> **Domain expert:** "Use a **Simplified Shell**, but keep controls as **Preserved Interactive Nodes** in their original context and expose usable shell actions through **Original Node References**."

## Flagged ambiguities

- "Extract useful data" was resolved as producing a **Page Snapshot** for the first milestone.
- "Tweak just UIs" was resolved as applying a **Live UI Patch**, not regenerating the functional page from JSON.
- "Delegate settings to AI" was reversed for the prototype; the **AI Patch Request** now uses predefined extension safety rules.
- "Multiple AI calls" was resolved as a copy/paste **AI Patch Workflow** for the first implementation, not direct in-extension Gemini API calls.
- "AI safety review" was deferred; the first staged workflow uses local validation, with **Patch Repair Request** as a later recovery path.
- "One-shot Gemini request" remains only as a legacy fallback; the primary flow is a strict linear **AI Patch Workflow**.
- "Drastic simplification" was resolved as a **Simplified Shell** with **Original Node References** for controls and **Original Node Relocation** only for non-interactive content, not a larger CSS-only patch.

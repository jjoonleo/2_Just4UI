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

## Relationships

- A **Page Snapshot** represents exactly one current browser page at one point in time.
- **User-Triggered Extraction** produces one **Page Snapshot** for the active browser page.
- A **Page Snapshot** may include **Form Metadata** but not user-entered form values.
- A **Page Snapshot** may include one **Visual Snapshot** when the user explicitly enables screenshot capture.
- A **Page Snapshot** is a **One-Time Result** unless the user explicitly copies or downloads it.
- **Local Extraction** produces **Page Snapshots** without sending them to a model.

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

## Flagged ambiguities

- "Extract useful data" was resolved as producing a **Page Snapshot** for the first milestone.

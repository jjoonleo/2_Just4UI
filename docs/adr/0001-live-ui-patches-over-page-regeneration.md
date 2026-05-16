# Live UI patches over page regeneration

The prototype preserves page behavior by applying selector-based **Live UI Patches** to the current browser page instead of regenerating the page from extracted JSON. This keeps original buttons, inputs, links, forms, framework state, cookies, and site event handlers in place while allowing Gemini to suggest CSS and safe presentation-only operations.

**Considered Options**

- Regenerate a simplified page from the Page Snapshot JSON.
- Patch the already-loaded page through the Chrome extension.

**Consequences**

- Gemini output is treated as a **Patch Plan**, not trusted replacement HTML.
- The extension validates and applies only conservative operations in the prototype.
- The regenerated page can remain useful as a visual demo, but it is not the behavior-preserving path.

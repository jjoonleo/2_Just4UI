# Gemini UI Patch API Suggestion

This document describes the contract for asking Gemini to simplify a live browser page without regenerating the page. Gemini returns a declarative Patch Plan; the Chrome extension owns validation and execution.

## Goal

Use Gemini for structural simplification decisions while preserving the original page's working buttons, links, inputs, forms, and site JavaScript behavior.

The Patch Plan stage should create a **Simplified Shell**, create actionable references to original interactive controls, and move only non-interactive original content into named shell slots. This is different from a CSS-only redesign: the visible interface can change dramatically, but functional controls remain in the page context where their behavior works.

## Non-Goal

Do not ask Gemini to generate a replacement HTML page.

Avoid:

```text
Regenerate this page as HTML.
```

Prefer:

```text
Create a Simplified Shell. Add usable shell actions that activate or reveal original controls in place, and move only non-interactive content into named shell slots. Do not clone or regenerate functional controls.
```

## Architecture

```text
Current page
  -> User-triggered Page Snapshot
  -> Page Analysis
  -> Simplification Strategy
  -> Compact shell Patch Plan
  -> Extension patch validator
  -> Trusted extension patch applier
  -> Live page shown through a Simplified Shell
```

Gemini chooses structure. The extension applies it with trusted local code.

## Patch Plan Request Payload

The final Patch Plan request should stay compact because Page Analysis and Simplification Strategy already compressed the page.

| Field | Required | Meaning |
| --- | --- | --- |
| `task` | Yes | Natural-language instruction asking for a simplified shell Patch Plan. |
| `designGoal` | Yes | Desired presentation outcome. |
| `snapshotSummary` | Yes | Counts and page-level context from the Page Snapshot. |
| `pageAnalysis` | Yes | Accepted Page Analysis artifact. |
| `simplificationStrategy` | Yes | Accepted Simplification Strategy artifact. |
| `selectorContext` | Yes | Compact list of selectors from the accepted artifacts. |
| `supportedPatchPlanOperations` | Yes | Patch operations Gemini may propose. |
| `forbiddenOperations` | Yes | Operations Gemini must not propose. |
| `responseContract` | Yes | Exact JSON shape Gemini must return. |

## Example Patch Plan

```json
{
  "schemaVersion": "bridge-ui-patch-plan/0.1",
  "operations": [
    {
      "type": "create_shell",
      "title": "School portal",
      "subtitle": "Key actions and information from the original page.",
      "slots": [
        {
          "id": "primary-actions",
          "title": "Start here",
          "description": "Original controls for account and visit actions."
        },
        {
          "id": "main-content",
          "title": "Main information"
        },
        {
          "id": "secondary-content",
          "title": "More"
        }
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
    },
    {
      "type": "collapse_region",
      "selector": ".footer-links",
      "slot": "secondary-content",
      "title": "Original footer links"
    }
  ],
  "css": "html.bridge-simplified-school #bridge-simplified-shell { max-width: 1080px; }",
  "preservationNotes": [
    "The login link and notices are moved as original DOM nodes, not cloned."
  ],
  "riskySelectors": []
}
```

## Selector Context Shape

The Patch Plan stage should not resend the full Page Snapshot. It should receive only selectors accepted by Page Analysis and Simplification Strategy.

```json
{
  "selector": "button.prod-buy-btn",
  "tag": "button",
  "text": "바로구매",
  "role": "button",
  "visible": true,
  "roles": ["preservedInteractiveNode", "emphasize"]
}
```

Recommended fields:

| Field | Meaning |
| --- | --- |
| `selector` | Selector Gemini may use in a Patch Plan. |
| `tag` | Lowercase HTML tag name. |
| `text` | Short visible text, trimmed and length-limited. |
| `role` | Native or ARIA role. |
| `visible` | Whether the node was visible in the snapshot. |
| `roles` | Why this selector is available to the Patch Plan stage. |

## Allowed Operations

Gemini may propose these operations:

| Operation | Meaning |
| --- | --- |
| `create_shell` | Create the visible simplified surface and named slots. |
| `reference_node` | Create a shell action that activates a safe original control or reveals a sensitive/form-like original control without moving it. |
| `move_node` | Move an existing non-interactive original node into a shell slot while preserving identity. |
| `collapse_region` | Move a lower-priority original region into a collapsible shell section. |
| `add_class` | Add a CSS class to an existing node. |
| `set_attribute` | Set a safe accessibility or `data-bridge-*` attribute. |

## Forbidden Operations

Gemini must not propose these operations:

| Operation | Reason |
| --- | --- |
| `replace_interactive_node` | Breaks attached site behavior. |
| `clone_interactive_node` | Creates fake controls without original listeners or state. |
| `rewrite_innerHTML` | Can destroy event listeners and page state. |
| `remove_form` | Breaks form submission and validation. |
| `change_href` | Changes navigation or purchase behavior. |
| `change_button_type` | Changes form behavior. |
| `synthetic_click_purchase_button` | Can trigger unintended real-world side effects. |

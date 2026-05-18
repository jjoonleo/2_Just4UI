# Repository Guidelines

## Project Shape

This repo contains one Chrome extension prototype:

- `Bridge Guided Task Mode`, loaded from the repository root.

The current product language is in `CONTEXT.md`; use those terms when discussing or changing behavior.

## Product Boundaries

Bridge is a guide-only browser assistance prototype. It may inspect the current page after user intent, create a guidance plan, highlight targets, scroll, explain, and observe progress. It must not click, type, submit, purchase, delete, confirm, or otherwise perform page actions for the user.

Preserve these privacy boundaries:

- Do not include user-entered form values in page snapshots or planning payloads.
- Do not send full raw DOM or screenshots to a model unless the user explicitly asks for a visual mode.
- Do not hardcode or commit API keys.
- Extension-side API key storage is acceptable only for local demo work; real release work should use a backend proxy.

Guided Task Mode has one active guidance session. It follows the active tab inside the same Chrome window, refreshes guidance on meaningful page/navigation changes, and keeps completed step history immutable.

## Important Files

- `manifest.json`: root MV3 extension manifest.
- `background.js`: root service worker, session lifecycle, model calls, page extraction, overlay injection, refresh logic.
- `sidepanel.html`, `sidepanel.css`, `sidepanel.js`: root side panel UI.
- `CONTEXT.md`: domain language and behavior rules.
- `plans/guided-task-mode-plan.md`: product/architecture plan for Guided Task Mode.
- `docs/page-snapshot-json.md`: snapshot format reference.
- `docs/hermes-agent-implementation-analysis.md`: comparison of Bridge with Hermes Agent browser/tool patterns.

## Local Commands

The root extension is plain MV3 JavaScript and has no package manager command. Validate root changes by loading this folder in Chrome:

```bash
/Users/ejunpark/Documents/brigde_hakerthon
```

## Validation

For root extension changes, manually verify on regular `http://` or `https://` pages. Chrome blocks injection into internal pages such as `chrome://extensions`, the Chrome Web Store, and some browser-owned pages.

Check at least:

- Side panel opens from the extension action.
- Starting a guide handles missing keys and unsupported pages cleanly.
- The overlay renders on the original page without blocking the target.
- The guide never performs page actions on behalf of the user.
- Navigation or active-tab changes refresh or pause the session instead of leaving a stale overlay.

## Coding Notes

- Prefer small, direct JavaScript changes. There is no build step for the root extension.
- Keep generated guide output strict JSON and validate it before rendering.
- Use selectors only as one target-matching signal; role, label, text, href, bounds, and nearby context also matter.
- Do not broaden extension permissions unless the task requires it.
- Keep README instructions aligned with the actual load paths and current product direction.

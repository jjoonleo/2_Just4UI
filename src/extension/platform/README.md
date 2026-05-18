# Chrome Platform Boundary

This folder is reserved for small wrappers around `chrome.*` APIs. Domain modules should depend on these wrappers instead of importing Chrome globals directly.

Use wrappers when behavior needs tests without a live browser:

- `runtime.ts` for messages and dashboard broadcasts.
- `tabs.ts` for active-tab, navigation, and window lookups.
- `storage.ts` for `chrome.storage.local` access.
- `scripting.ts` for page injection.
- `side-panel.ts` for side panel setup.

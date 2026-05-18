# Service Worker Boundary

`main.ts` is the current MV3 extension service worker entry point. It owns Chrome event registration, guidance-session orchestration, provider calls, page extraction injection, overlay injection, Plan Refresh, and dashboard notifications.

Future refactors should split this file by responsibility while keeping `main.ts` as the thin composition root:

- `message-router.ts` for `chrome.runtime.onMessage` dispatch.
- `session-lifecycle.ts` for Guidance Session start, refresh, pause, and end behavior.
- `session-store.ts` for persisted Session State and Guide Activity access.
- `tab-events.ts` for navigation, active-tab, and tab-removal events.
- `provider-client.ts` for selecting Backend Proxy, Gemini Demo, or OpenAI Demo.
- `page-injection.ts` for `chrome.scripting.executeScript` boundaries.

Do not move page-DOM code into this folder. Code that runs in the original page belongs under a content boundary.

# Content Boundary

This folder is reserved for code that runs in the original browser page through `chrome.scripting.executeScript` or content-script packaging.

Bridge content code may inspect the page, collect Page Snapshots, highlight Page Targets, scroll, render overlays, observe Page State Changes, and report user progress. It must not click, type, submit, purchase, delete, confirm, or otherwise perform page actions for the user.

Expected future modules:

- `page-snapshot.ts` for Page Snapshot collection.
- `planning-payload.ts` for reduced Planning Payload creation.
- `overlay.ts` for guide overlay rendering and cleanup.
- `target-matching.ts` for selector, role, label, text, href, bounds, and nearby-context matching.
- `page-state-observer.ts` for meaningful Page State Change detection.

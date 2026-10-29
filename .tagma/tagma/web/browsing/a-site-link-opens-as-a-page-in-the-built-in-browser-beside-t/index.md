---
id: 01a14c08-1c3f-7bde-a2e3-046371947f5b
title: A site link opens as a page in the built-in browser beside the thread on click, and in the system browser on ⌘-click
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Links.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Pane.svelte.ts
  - kind: symbol
    ref: apps/tagma/server/src/browser/contract/wire/settings.ts
    symbol: openLinks
---
**Value.** A link from an agent answer, a document, or terminal output opens beside the thread instead of pulling the operator into the system browser.

**How.** The `browser.openLinks` setting (on by default, per user and per project) decides which browser is the "beside" place for a site; `links.click` swaps click and ⌘-click. Clicking an external http(s) link in the Tagma window and in the terminal opens it as a page in the browser panel on the right.

**Behaviour.**
- ⌘-click (Ctrl outside macOS) opens the link in the system browser — both in the window and in the terminal. With `browser.openLinks` off, a plain click opens the system browser too.
- A link whose page already stands as a tab beside switches to it; otherwise the already open browser panel takes the page instead of a new panel; "Open in new browser tab" in the right-click menu opens a new one. The page tab header carries "Open in system browser".
- When the page cannot be opened (for example, the profile's host is disconnected), the link goes to the system browser, and the refusal is shown to the operator.

**Limits.** Links of the same origin as the Tagma window are not intercepted. There is no interception on the phone. The code editor has no link handling of its own.

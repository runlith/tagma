---
id: 01a14c08-1c3f-7bde-a2e3-046b8ddec8bc
title: Page dialogs, hangs, and crashes show in the panel and on the phone, and human and agent answer them
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/PageNotices.svelte
  - kind: file
    ref: apps/tagma/desktop/src/browser/page.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/drive.ts
---
**Value.** A page dialog, a renderer hang, or a crash does not stop work silently: human and agent see that the page is waiting and answer it.

**How.** A plaque above the page in the panel and on the phone; the `answer_page_dialog` operation; page state in `list_pages` and the `browser.pages` feed.

**Behaviour.**
- Alert, confirm, prompt, and "leave the page?" show as a plaque with an answer. While a dialog is open, other actions on the page refuse with `dialog-open`.
- Closing a page that asks to stay opens its leave-dialog and waits for an answer: agreeing closes, refusing keeps the page and answers `page-stayed`.
- On desktop, a dialog on a page driven by an agent waits for the engine's answer; without an agent it shows natively, and on an agent-session break it goes to the human at once.
- A hung page is marked "not responding" with Reload and Close buttons; a crashed one — "crashed" with Reload. Agent actions on them refuse except reload and stop. An engine-owned CPU slowdown scales the responsiveness threshold, and an engine-owned pause suspends it, so measurements do not falsely mark or replace the renderer.
- The engine probes an attached out-of-process iframe separately. Its hang marks the page unresponsive and refuses page work, including in-place reload, with the frame's identity and address. Recovery guidance offers another profile or waiting for the profile browser to end, and names live same-profile pages with their opening threads or non-thread origins: agents close only their own pages, asking the operator about the rest.

**Limits.** On desktop `prompt()` is not supported by Electron: the page gets `null` at once. A leave started by the page itself does not repeat after agreeing — its next attempt goes through. Desktop watchdog strain follows exact renderer process identity; CPU strain widens to the profile only during pending navigation toward an unknown speculative renderer, returning on commit or failure, while heap pause stays on its captured PID. Managed watchdogs and engine OOP-frame probes use profile scope where CDP exposes no renderer identity, so another genuinely hung page or frame within that scope is detected only after the known strain ends.

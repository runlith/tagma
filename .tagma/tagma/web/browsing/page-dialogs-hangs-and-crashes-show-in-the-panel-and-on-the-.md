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
**Value.** Dialogs and renderer failures have one shared state for the operator and the agent.

**How.** A plaque above the page in the panel and on the phone; `answer_page_dialog`; page state in `list_pages` and the `browser.pages` feed.

**Behaviour.**
- Alert, confirm, prompt and leave dialogs show an answer. While one is open, page actions refuse `dialog-open`.
- Closing a page that asks to stay waits for its leave answer: agreeing closes it; refusing keeps it and answers `page-stayed`.
- On desktop, a dialog on an agent-driven page waits for the engine; without an agent it shows natively, and an agent-session break returns it to the person.
- A renderer proved unresponsive is marked with Reload and Close actions; a crashed renderer is marked with Reload. Agent work refuses on those known states except recovery navigation.
- A hang verdict requires CPU consumed by the same attributed renderer while its probe stays unanswered. A pause excludes sampled CPU; throttling spends less actual CPU rather than widening a wall-clock deadline. Desktop root renderers have native PID and creation-time attribution.
- Without exact attribution, silence produces no hang verdict. Managed pages and engine out-of-process frame sessions wait for their own answer, crash, close or session end, and their callers can cancel the wait.

**Limits.** Electron does not support `prompt()`: the page receives `null`. A page-initiated leave does not repeat after agreement; its next attempt goes through. A silent managed renderer may survive target closure and be reused by a same-site page; a profile-browser exit or another profile is the recovery boundary when its process cannot be identified exactly.

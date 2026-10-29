---
id: 01a14bc0-76f5-7c7d-bd06-8e7f03fd84a3
title: "On the phone Tagma opens as a phone shell: Inbox, project threads, full-screen thread, and settings"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14bc0-7696-71f4-8eeb-ff1e8a780ecb
  - kind: relates
    to: 01a14bc0-76c7-7595-a09a-82c02494791d
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/app/mobile
  - kind: file
    ref: apps/tagma/app/src/lib/features/shell/Choice.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/shell/shell.ts
  - kind: file
    ref: apps/tagma/app/src/routes/[project]/chat/+layout.ts
---
**Value.** From the phone the operator answers agents, reads and writes in threads, and sorts them, without fitting a desktop screen under a finger.

**How.** Turns on itself on a touch screen or by layout choice in Settings → Layout; tabs below: Inbox, Threads, Pages, and Settings.

**Behaviour.**
- Inbox: agent questions with option buttons right in the card, plugin questions, crashed and finished runs.
- Threads: projects, search, filters, folders, and pinned; swipes and long-press to pin, archive, rename.
- Thread full-screen with composer, camera attachments, model and mode choice.
- Offline the shell shows the last loaded and the cause, and on a cold start opens from cache.

**Limits.** Graph, checkout, rules, calls, and plugin views do not open on the phone — the shell refers to the machine. A terminal-CLI thread is not run on the phone. The Mac app always stays in desktop layout.

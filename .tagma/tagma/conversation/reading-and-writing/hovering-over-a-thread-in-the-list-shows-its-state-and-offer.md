---
id: 01a14bc0-76ff-7aba-ae6f-ec4915d6adf4
title: Hovering over a thread in the list shows its state and offers quick actions
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9285e59adbe3
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9286739b512c
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9288c2f9fd4b
  - kind: relates
    to: 01a14bc0-7609-7d58-a98e-72588a9bdc58
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Peek.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/threadPeek.svelte.ts
---
**Value.** The operator learns a thread's state and acts on it right from the list, without opening the feed.

**How.** Hovering a thread row in the list, or Space on the focused row.

**Behaviour.**
- The card shows state, model, context and cache warmth, uncommitted lines, child processes and commands.
- Under the title stands one of two things: the recap, if the thread has no messages after it, otherwise the last spoken line. A stale recap is not shown in the card.
- Actions depend on state: answer a question, continue a crashed run, stop a running one, pin, detach, archive or compact a finished large thread, return from archive.

**Limits.** While an act is running, the card's buttons are busy.

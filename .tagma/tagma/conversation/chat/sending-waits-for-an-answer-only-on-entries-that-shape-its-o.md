---
id: 01a15f7e-033c-7df1-b61e-31ad568735bc
title: Sending waits for an answer only on entries that shape its own thread's turn
ord: 63
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15eeb-6b48-7ca8-9c93-24d9511b80d7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadAuthority.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/thread/ThreadSettings.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/session/TurnShaping.ts
---
`TurnShaping` lives per project in app scope and holds unfinished entries by key: a thread id or, for a yet-unborn one, the draft key. A send takes their set at press time and waits for it before handing the turn, and for a draft — before the thread's birth, because birth takes model and account from the already-kept choice. Entries made after the press and other threads' entries never hold it; an entry refusal holds the send no longer than its answer.

The entry's own owner sets and clears the mark — the `ThreadSettings` queue, `ThreadAuthority`, the command-write promise — not the caller's wait: a closed panel cuts its own wait, but an entry the thread continues in another panel still holds Enter. The model mark clears as soon as `thread.model` answered; keeping defaults after that shapes no turn and holds no Enter.

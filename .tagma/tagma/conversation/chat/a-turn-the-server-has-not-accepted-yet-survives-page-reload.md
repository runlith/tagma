---
id: 01a132c0-3d5c-77d4-b807-e6ab793c6887
title: A turn the server has not accepted yet survives page reload
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a132b2-cbca-7974-b525-93d0a338a185",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PendingStore.ts
  - kind: file
    ref: packages/chat-ui/src/session/PendingTurns.ts
---
Sending cleared the draft at once, while the turn lived only in `PendingTurns` memory: when the server never answered (restart, post-load overload), a page reload lost the words whole. This lost the operator's message in thread 01a1325b after a server restart.

Make: `PendingTurns` holds every started turn in the `PendingShelf` port until the server answers; the app fills the port with the project localStorage. The next page resends a handed turn under the same key (the server knows a repeat by key), and returns an unhanded one to its draft.

Proof: tests in `TurnCommands.svelte.test.ts` — the next page delivers a turn once under its key and forgets it after the answer; words that never reached the server return to the draft.

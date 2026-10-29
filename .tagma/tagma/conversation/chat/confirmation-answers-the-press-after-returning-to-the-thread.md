---
id: 01a12c96-3722-7ec9-bb57-9da9a800e9c4
title: Confirmation answers the press after returning to the thread, and a notice stays in its thread
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c8d-2157-745f-850a-5d81e92c5893",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/chat-ui/src/ChatFold.svelte.ts
  - kind: file
    ref: packages/chat-ui/src/session/TurnCommands.svelte.ts
---
The operator presses "Read" on a confirmation in a thread feed and gets "There is no open question here.", while the server never gets the answer; the same banner later stands in another thread.

**Reason 1 — frozen `$derived`.** `ChatFold.openQuestion` is `$derived`, owned by the effect root of the `ThreadFeed` service the session is built in. The fold outlives this root: on leaving the thread it parks in `DetachedSessions` and is picked up by the next session. Svelte 5.57 (`execute_derived`) answers a destroyed effect's derived with its last value forever, so after returning to the thread `openQuestion` stays `false` while `VisibleFeed` honestly shows the card. `TurnCommands.answerQuestion` checked exactly this boolean and refused locally.

**Reason 2 — notice without an address.** `TurnCommands.shown` is one per slot, `aim()` does not touch it, so one thread's notice shows in any thread opened next.

**Do.**
- `ChatFold` holds no `$derived`: `openQuestion` and the check for a specific question read the index directly.
- One function over an entry decides "is the question open"; the fold, the feed, the freeform question, and the cards use it. The projection of an answered question always carries `answers`.
- `answerQuestion` checks the pressed `questionId`, not "is there any open question".
- A notice belongs to the target it was raised for and is not shown on another.

**Proof.** A chat-ui test: a session built under an effect root goes to the shelf, the root is destroyed, the thread reopens with the same fold, and pressing the confirmation reaches the server; one target's notice is not visible after `aim` at another. Chat-ui and app typecheck.

---
id: 01a14bc0-75fb-7fcc-8d33-a734ed6ae602
title: "A sent message is not lost on connection break or reload: the turn arrives once under the same key or returns to the draft"
ord: 6
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-927c37d1b13b
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/native/PendingStore.ts
  - kind: file
    ref: packages/chat-ui/src/entries/UserMessageRow.svelte
  - kind: file
    ref: packages/chat-ui/src/session/PendingTurns.ts
---
**Value.** A pressed "send" does not vanish silently on a connection break or reload: the turn arrives exactly once or returns to the draft. This matters on the phone and flaky networks.

**How.** By itself, on every send.

**Behaviour.**
- The composer clears at once, and the turn lives in the browser with its attachments until the server answers.
- Every turn carries a browser key; a repeat under the same key is recognized by the server, which makes no second turn.
- An unconfirmed turn resends itself several times, then "send again" and "forget" remain under the message.
- A reloaded page picks up the closed page's turns: a transmitted one resends under the same key, an untransmitted one returns to the draft. It never touches turns of a neighbouring live tab.

**Limits.** Without browser storage sending works but does not survive reload.

---
id: 01a185bb-809f-7071-8c79-5f7fbf0d1709
title: A thread owed its own command's end shows as working, not finished
ord: 134
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1857f-9a81-7c54-a350-56f618f53175",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a17aed-c2a9-727a-a27e-a3b8b67d7441
---
A thread whose turn ended while its own background command or background call still runs is shown as finished: no mark, a green "finished — unread" on a root, a `finished` Attention event, and its ancestors' chevrons, counts and worker names do not count it. The server already knows the fact (`OwnWork.owing`, used by keep-warm and the fallback report); the list and its events do not read it.

**Change.**
- The thread row carries `owes`: no run going, and the thread is owed the end of its own background command or background call. `OwnWork` derives it; the list reads attach it, no second derivation.
- `standingOf` raises no `finished` standing while the thread owes an end; the end wakes it, and the turn that reads it ends with a new run id and its own standing.
- The app draws such a thread as a still amber tile (the work colour without the breath of a model turn), titled "waiting on its command — wakes when it ends"; the team sum below a parent counts it as working, so ancestors get the amber chevron, the count and the name.
- The command-count badge in the row stops using the blue of "waiting on you".

A held terminal (`start_terminal`) opens no delivery and is not owed: it does not light the thread.

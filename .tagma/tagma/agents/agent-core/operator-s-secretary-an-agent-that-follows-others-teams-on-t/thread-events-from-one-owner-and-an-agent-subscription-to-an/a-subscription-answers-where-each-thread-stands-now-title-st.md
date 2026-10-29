---
id: 01a1650e-6480-7550-949f-c6063274b361
title: "A subscription answers where each thread stands now: title, state, question or cause, last said row"
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1650e-8a0e-7171-a68b-aa40929594bf",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a16449-f3a3-7a52-9c4a-90515fc6ae4f
---
A subscription answers where each thread stands now: title, state, question or cause, last said row.

A subscription wakes only on change. When a thread already stands at subscribe time — rested, awaiting the operator, or failed — no event fires until it moves. The `subscribe_threads` answer names only `threadId` and `projectId` (`followed` in `threads/operations/subscriptions.ts`), so the subscriber calls `list_threads` second. That is what happened on 2026-10-22: subscribing to the "Rules" thread never said it had idled since 19:03.

`subscribe_threads` and `read_subscriptions` answers carry, per thread, where it stands now:
- title;
- state: working, rested, awaiting the operator with the question text, failed with the cause;
- when the thread last moved;
- its last said row.

State comes from the same owner that already yields the thread row and the "Attention" event. No second derivation.

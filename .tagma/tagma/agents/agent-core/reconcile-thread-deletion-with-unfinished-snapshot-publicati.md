---
id: 01a16d34-ca3c-771b-b611-881fd6ff2679
title: Reconcile thread deletion with unfinished snapshot publications
ord: 107
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16d35-28c9-72b1-8626-98f11e1223c3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16d1e-a3b3-71f4-a72a-bcc27993639d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadDeletion.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
---
Reconcile thread deletion with unfinished snapshot publications.

`instructionRefresh.itest.ts` passes, but scoped cleanup via `projectLeaving` → `ThreadTurns.delete` leaves `ThreadCallBroke: Thread not found` from `ThreadSnapshots.reading` when reading an already-deleted thread's metadata. Reproduced separately on seed 1 and in the family of 20 HTTP files; the shared world stays alive. `ThreadDeletion` removes rows after the settlement run, but `ThreadSnapshots` holds its publications and status deadlines separately. Find the exact unfinished work and close it at the deletion owner, with no waits or warning suppression in the fixture; prove it through the same deletion door after finished runs.

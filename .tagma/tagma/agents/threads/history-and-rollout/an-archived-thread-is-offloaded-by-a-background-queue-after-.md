---
id: 01a12750-bbba-7e7e-96dd-2b59c0cc6ae8
title: An archived thread is offloaded by a background queue after run recovery, not by the archiving act
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutEviction.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutShelf.ts
---
Archiving and reading a thread through `ThreadEvidence` only enqueue it (`rollouts.shelve`). One fiber (`rollouts.shelving`) drains the queue, started on `Maintenance.opened`. That maintenance opens after native `recover()` has awaited the end of the run-recovery pass.

The queue re-checks archived-ness inside the thread's lane: a thread back from the archive is not offloaded. So a batch-archiving act holds the database writer no longer than before.

`ThreadEvidence` reads and `send`/`steer`/`continue` acts run under `rollouts.using` (`journal/uses.ts`). While the thread is in use, background offload answers `in-use`. New use awaits the running offload. When the last use ends, the thread is queued again. Rewinds (`rewinds`) do not run under `using`.

Before offload the rollout cursor is caught up inside the thread's lane. Reason: archiving appends meta to the file, and without the catch-up offload would refuse with `cursor-behind`.

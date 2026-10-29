---
id: 01a1259b-0f10-7c85-adde-f6013603b6a7
title: Inspection pool gives a free worker to the earliest matching request; background yields to foreground between portions
ord: 16
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12592-46d7-7949-ade0-efb0aee29f9b
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspectionLanes.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/traffic.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/turns.ts
---
Inside the pool, a freed slot passes directly to the earliest matching waiter, in the same synchronous operation. Effect's `Semaphore` does not do that: it wakes waiters as a deferred task, and a chain of requests from one slice job, which asks for the next request right after the reply, grabs the permit first. That is how a single-request rule stood idle for 27.6 s behind `platforms` while a second worker sat free.

- **Pinned request** (`{ seat }`) waits only for its own slot. Slices of one job are pinned because the plan snapshot and frontier live in the memory of the worker that built the plan.
- **Unpinned request** takes any free slot. A slot where the rule has already been judged (`warm`) is only preferred: waiting for it is forbidden, a warm cache is cheaper than idling.
- **Several free slots** — the one with fewer pinned jobs is taken: their next requests will come there.
- **Interruption** removes a waiter from the queue, and a seated one gives up its slot. Both cases go through a single `leave`, so no slot is lost in any outcome.

A background re-measure runs sequentially between checkouts. Before every worker request, including the next slice, it yields to all already accepted foreground inspections, regardless of their pool. A request already running in a worker finishes; the next portion waits. So the foreground never stands behind the whole startup queue. A hold of a slice job keeps the worker claimed during that pause too: idle-retirement must not lose its plan and frontier. Releasing the hold reschedules retirement, even if the previous idle check ran during the pause.

---
id: 01a1276c-56dc-767d-9470-f353d5f5b030
title: Fill the "said" row of threads in SQL with a one-time pass after start
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1267b-9010-7ed8-ab9d-f3fd930f4d29",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-4224d802b89f
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79efc3af42eb
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/saidFill.ts
---
After the update the "said" row stands empty for threads lying in SQL: the `thread_run.said_live`/`said_final` columns are written only by fold on a new record. A one-time pass after start is needed.

- Selection: threads neither archived nor evicted whose shown run (the running one or the last finished one) is still uncomputed (`said_final is null`); freshest in list order first.
- Computed "empty" is stored as `''`, distinct from `null` "uncomputed"; the list reads `''` as no row. The pass ends: a counted thread is not selected again.
- One thread is one transaction, pausing `max(25 ms, hold)`; start on `Maintenance.opened`; an interrupted pass continues at the next start.
- The open list gets the row through `ThreadList.announceThread`.

Start: `threads/list/said.ts`, `threads/harness/engine.ts`. Done: itest through a server start, the pass measured on a database clone.

Done: 89f0a79517, 532d13d028. Order is `reader_order_at desc` (list order). Measured on a clone (one sample): 376 threads, 0.85 s of work, maximum hold 50 ms (272 ms on the first cold pass), empty start 1.5–3.8 ms. Not proved by test: delivery of the row to the open list (`announceThread`) and equality of the fold-record skip to a full recount (`movesSaid`).

Single-machine transition code: the pass (`threads/list/saidFill.ts`, `unsaidThreads` and the call in `engine.ts`) leaves at the next base-migration fold.

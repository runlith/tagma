---
id: 01a12592-46d7-7949-ade0-efb0aee29f9b
title: "Slow commit: eviction in the inspections cache is quadratic, and the landing-worker queue lets late arrivals jump ahead"
ord: 157
tags: ["task"]
fields:
  {
    "holder": "tagma:01a122bd-84ed-7d7f-8953-10fb863f721a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12374-c867-7738-999c-81b688df5ae7
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/cache/store.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspectionLanes.ts
---
Commit `9c3cf8d6` took 33 s; 16.8 s of it was writing the `platforms` slice result into the inspections cache, and the `swallowed-failures` rule spent another 27.6 s queued behind `platforms` while the second worker sat free.

1. `giveWay` in `cache/store.ts` frees space one row at a time under SQLITE_FULL, and each row is found by a UNION query over three tables: 0.33–0.9 ms per row, 15k rows per 16 MB — 13.5 s measured on a copy of the live cache. One pass over the age indexes is needed, costing O(evicted).
2. Effect's `Semaphore` is not FIFO: releasing wakes waiters lazily, while the same slice job's synchronous next request grabs the permit first. Pinning a rule to a worker parks the request on a busy worker while another sits free. A dispatcher in arrival order is needed: a free worker takes the earliest matching request, slices of one job stay on their own worker.
3. Cache writes after computation (`memo.commit`, `cache.flush`) carry no span marks — add them so the next such duration is visible.

Done when: the giveWay measurement on the same cache copy is linear; queue tests prove arrival order and a free worker's work; enforcement itests are green.

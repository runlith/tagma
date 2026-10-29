---
id: 01a0c85e-a27b-766b-ad10-f5740e125143
title: A retention group closed while the performance store is unavailable is never released, and pins the ring for the life of the process
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0c84b-5b6d-782c-aa9f-aaff93e27bf4
sources:
  - kind: symbol
    ref: packages/performance/src/RetentionGroups.ts
    symbol: RetentionGroups
  - kind: symbol
    ref: packages/performance/src/store/store.ts
    symbol: closeGroup
  - kind: symbol
    ref: packages/performance/src/store/store.ts
    symbol: workerGone
---
A producer that opened a retention group while the store was ready and closed it while the worker was gone never gives the group back. `closeGroup` returns at once when the state is `unavailable`, so the depth is never decremented and `pending.release` is never called; `workerGone` clears the in-flight buffers and the waiters but leaves `retentionGroups` standing, and only `shutdown` — the store ending for good — clears it. When the replacement announces itself the state returns to ready with that key still held by a producer that has already left.

The cost is the one [[93e27bf4]] names: a key in the protected list stops eviction at the oldest segment it wrote into, nothing distinguishes a group that ended from one that was abandoned, and the ring then stands over its bound for the life of the process. [[da8bd555]] states the current behaviour as the code has it, so this task is the defect, not a contradiction of that claim.

Whether a shipped producer can reach it is the first question to settle: today's tracer hands a trace over synchronously, so the open and the close sit close together. The contract permits the straddle regardless, and the profiler and capture services hold groups across suspension points.

Done when a close during an outage either releases the group or is recorded so the replacement can, with a test that opens a group, takes the worker away, closes the group, brings a worker back and asserts the ring can evict.

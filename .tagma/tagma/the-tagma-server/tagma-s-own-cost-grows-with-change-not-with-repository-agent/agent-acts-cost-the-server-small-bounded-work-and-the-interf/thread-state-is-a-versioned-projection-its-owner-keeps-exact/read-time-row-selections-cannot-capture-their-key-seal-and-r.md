---
id: 01a19888-3749-73c6-8c8d-4675e44d6479
title: "Read-time row selections cannot capture their key: seal and read evaluate one compiled selection"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19878-4d78-70d5-a678-880d7defc965",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/projections.ts
  - kind: file
    ref: packages/sqlite-process/src/host.ts
---
Follow-up to hotfix `7ac4dab4f`. That hotfix renamed the outer table in the thread list's read paths. It left the cause open: a read-time selection inlined whatever SQL its caller passed as the key. Any selection reading the caller's own table therefore bound the key to its inner row, so every key read the same answer.

Wanted:
- `selectRows` owns the key reference. A selection compiles once over a key relation that no selection can name. The seal path binds that relation to a parameter and the read path binds it to the caller's column, and both evaluate the same compiled text. Callers pass a column, never SQL. The hotfix alias goes.
- A projections contract test reads a selection over its outer query's own table, read against seal. A ThreadRows test reads two unrelated trees in two projects, through held rows and through the narrow sets.
- Cut out of this delivery: the SQLite child refusing an answer past a 256 MiB byte budget, with a typed failure naming the statement fingerprint and size. Review found unpaged legitimate readers that a large, valid graph can push past any fixed budget: `graph/tree/projection.ts` `projectToTree` reads every block body of a project in one answer, and `graph/tree/connections.ts` reads every edge and source. The guard lands only after those readers are paged. Its finished code and test wait as `reply-guard.patch` in the key-capture thread's scratch.
- A scale itest seeds a few thousand threads and bounds the statement count and the bytes per row of the held and narrow reads.

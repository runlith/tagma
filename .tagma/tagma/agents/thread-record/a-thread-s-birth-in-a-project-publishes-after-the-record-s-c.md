---
id: 01a11271-4d56-7a1b-8c6d-a894399afb8d
title: A thread's birth in a project publishes after the record's COMMIT, shared by root, child, and fork
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/thread-record/layer.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: symbol
    ref: apps/tagma/server/src/thread-record/contract/service/records.ts
    symbol: ThreadRecords
---
The visible list follows the record's committed existence in the project: `insert` with scope and the first inclusion of a scopeless record in a project publish a birth, `remove` — a disappearance; rollback creates no event. Harness readiness is checked after birth and may end in deleting the already-published fork, so both transitions belong to `ThreadRecords`, not to the calling operations. A subscriber failure is diagnosed separately and does not change the fate of a COMMIT that happened. `ThreadList` takes these facts by one shared road; creation needs no publication or run of its own.

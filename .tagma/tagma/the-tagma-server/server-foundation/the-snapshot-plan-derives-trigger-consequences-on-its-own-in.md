---
id: 01a126f1-0c11-788b-b4e3-fe4babe49aaf
title: The snapshot plan derives trigger consequences on its own instead of the record owner's answer
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-421edbf2cadc
sources:
  - kind: symbol
    ref: apps/tagma/server/src/platform/store/snapshotPlan.ts
    symbol: snapshotPlan
---
`platform/store/snapshotPlan.ts` walks SQL triggers and their columns on its own, although the same fact is now answered by `writes.ts`. That is a second derivation of the fact about write consequences. Replacing it must preserve modelling create/drop/rename in the waiting chain and the snapshot's standing guarantees; the narrow key-check task does not change this code by its spec. Start with `snapshotPlan.ts:written` and `writes.ts:reachedWrites`; prove with the former set of preserved tables and a successful restore on the existing snapshot integration tests, including a trigger change inside the chain.

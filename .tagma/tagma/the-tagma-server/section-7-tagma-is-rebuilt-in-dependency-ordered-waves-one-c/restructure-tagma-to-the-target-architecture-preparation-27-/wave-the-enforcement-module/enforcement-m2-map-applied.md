---
id: 01a0e532-cbac-7455-9a87-da05e51a3802
title: "enforcement M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e519-2c8e-7307-95c7-b14b4134178c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-cba3-798b-898d-15974efb8351
---
§7.2.2 milestone `M2` of the `enforcement` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]]. Fourth post-freeze file: `enforcement/slicing.ts` → `enforcement/workers/slicing.ts`; move `slicing.test.ts` and `slicing.bench.ts` beside it.
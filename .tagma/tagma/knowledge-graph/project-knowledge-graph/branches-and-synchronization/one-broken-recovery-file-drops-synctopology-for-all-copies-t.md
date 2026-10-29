---
id: 01a1310b-ef0f-7f04-8396-c7c08327412d
title: One broken recovery file drops syncTopology for all copies through TreeMerges.retireGone
ord: 22
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a130b1-5726-7fb5-9119-abbaed0bf21e
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/merges.ts
---
`graph/tree/merges.ts` `TreeMerges.retireGone`: one unreadable recovery file drops `syncTopology` for all copies. Same class as ed0bf21e: one entry's failure is isolated in it and named a typed failure, the other copies sync as usual. Done: the test — one broken recovery file, the other copies' `syncTopology` passes, the broken one named.

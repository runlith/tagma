---
id: 01a18a3e-dba7-7a87-b6ac-499376e08c53
title: Keep mirror regression fixtures compatible with the untagged graph root
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3d-01ca-72b1-88a2-2c15a829cc7d",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a12c9f-b2ce-7ab2-85aa-44fb872121e7
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/repairMatrix.itest.ts
---
Remove obsolete root tags from the mirror contract fixture so it reaches the existing displacement, trash restoration and duplicate-identity assertions. The copied fixture currently refuses with no-root before all thirteen test bodies; verify the repaired contract suite without changing mirror behaviour.
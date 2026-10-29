---
id: 01a15a5e-05cc-71a4-bea5-c86b90d66711
title: Cross-project edge reads open no foreign copies and wait on no permits of theirs
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a159a1-5659-786f-8088-acd20618c9aa",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a159ae-2c87-7eea-be0d-532f4476383d
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/foreign.ts
---
On a live server after restart, the first `read_block` of rule 18ad9402 in law-lab took 54.8 s: `Act.farPointers` → `GraphPool.foreign.pointing` reopened every copy without phase words (`GraphPool.acquire`, `projectPermit.wait`). `ForeignBlocks` reads move onto the copies' mirrors alone, with no opening and no `fresh()`; an unready copy answers as `unread` or an unknown phase, and copies open in the background (`warm`). `elsewhereNames` asks `titles` without settle. Proof: `farEdges.itest.ts` and a measurement on `tagma:try` with six projects right after start.

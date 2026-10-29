---
id: 01a17920-2246-7f0e-ad5b-f921bb27fac2
title: "A subtree moves between graphs: birth in the target, departure from the source, edges and other projects' addressed edges"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1790d-c718-7101-b25d-b9da9c7cf162",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1791f-3e3a-7001-8f34-c91e7840a792
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/relocation.ts
---
Do per [[7840a792]]: `update_block` with a `parentId` in another graph moves the whole subtree with its state; the target judges it by its own dictionary; edges inside, outward, inward, and from other projects become correct; a failure between acts leaves the subtree in both graphs.

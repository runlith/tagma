---
id: 01a0c830-ca98-79fe-8169-b9fe9eb4558a
title: Build the zone for packages/seam
ord: 74
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1c96-7e48-a189-0bf3f3eeb9fa",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/seam
---
Wave 1, builder alone: `packages/seam` (375 lines, 4 files) is a module by construction; depends on utils (built). The builder writes the module, its `depends-on` edge and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
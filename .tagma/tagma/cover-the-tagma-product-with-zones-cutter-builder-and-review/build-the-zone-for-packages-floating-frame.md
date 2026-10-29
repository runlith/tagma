---
id: 01a0c830-ca9b-7897-ad29-6032cbe468a6
title: Build the zone for packages/floating-frame
ord: 75
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1d7d-70a6-bf39-c9491d70ca43",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/floating-frame
---
Wave 1, builder alone: `packages/floating-frame` (273 lines, 3 files) is a module by construction; depends on utils (built). The builder writes the module, its `depends-on` edge and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
---
id: 01a0c830-ca95-7384-a461-53fe36d4d6c1
title: Build the zone for packages/trace-bundle
ord: 73
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1aed-7dab-8b55-b8df4dbaa8ad",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/trace-bundle
---
Wave 1, builder alone: `packages/trace-bundle` (1,720 lines, 6 files) is a module by construction; depends on trace (built). The builder writes the module, its `depends-on` edge and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
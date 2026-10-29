---
id: 01a0c6e3-56c8-7148-a0f0-8e2022735945
title: Build the zone for packages/trace
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6e6-c3ce-73d4-a39d-624a37b914d6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/trace
---
Wave 0, builder alone: `packages/trace` (850 lines) is a module by construction; the builder writes the module and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
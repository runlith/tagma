---
id: 01a0c830-ca93-7727-b381-91fe9eb3cad7
title: Build the zone for packages/query
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1a78-7fb6-86d9-bef1c27f6e6a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/query
---
Wave 1, builder alone: `packages/query` (2,456 lines, 24 files) is a module by construction; depends on layer (built), `testing` from suites alone. The builder writes the module, its `depends-on` edge and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
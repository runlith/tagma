---
id: 01a0c830-ca9e-7174-861e-30bb35c9fb8c
title: Build the zone for packages/desktop-host
ord: 76
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c832-1bb2-7958-992c-41008f041757",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/desktop-host
---
Wave 1, builder alone: `packages/desktop-host` (361 lines, 4 files) is a module by construction; depends on utils (built). The builder writes the module, its `depends-on` edge and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
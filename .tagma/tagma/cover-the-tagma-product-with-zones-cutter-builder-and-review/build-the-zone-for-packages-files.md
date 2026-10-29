---
id: 01a0c6e3-56b9-736b-b26f-a75dc18b877f
title: Build the zone for packages/files
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6e6-5d74-7966-9518-e2454448fb78",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/files
---
Wave 0, builder alone: `packages/files` (313 lines) is a module by construction; the builder writes the module and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
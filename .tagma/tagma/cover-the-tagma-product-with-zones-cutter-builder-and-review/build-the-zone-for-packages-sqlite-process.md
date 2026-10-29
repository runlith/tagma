---
id: 01a0c6e3-56d1-7cd7-9051-0a4b98d6ad47
title: Build the zone for packages/sqlite-process
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6e6-c5dd-7d31-83ce-87174fb26bcb",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/sqlite-process
---
Wave 0, builder alone: `packages/sqlite-process` (2425 lines) is a module by construction; the builder writes the module and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
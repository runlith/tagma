---
id: 01a0c6e3-56cd-7578-87a7-4f5facbc88d9
title: Build the zone for packages/ndjson-rpc
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c6e6-c4fc-7d46-9586-0629c630684c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/ndjson-rpc
---
Wave 0, builder alone: `packages/ndjson-rpc` (689 lines) is a module by construction; the builder writes the module and its claims from the code, verified, then a reviewer reads it and the head accepts it per the decision's acceptance list.
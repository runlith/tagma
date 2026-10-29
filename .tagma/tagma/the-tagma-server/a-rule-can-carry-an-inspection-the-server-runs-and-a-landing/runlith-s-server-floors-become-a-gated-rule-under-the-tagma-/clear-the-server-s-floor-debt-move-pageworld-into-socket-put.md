---
id: 01a0d55b-28af-7845-a303-938d0c9b09b0
title: "Clear the server's floor debt: move `pageWorld` into `socket/`, put `terminals/` below `harness/`, place `install/`"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d55c-c630-7cb4-a446-60905c86177a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d4db-9d8b-7af7-9481-2eb115d47c9d
---
Per [[15d47c9d]] Before enforcing, done under today's `boundary.direction.ts`: move `terminals/pageWorld.ts` and `pageWorldServer.ts` into `socket/` with their two server suites, the script, and the three app suites that name the path in a string; give `terminals/` its own floor below `harness/`; place `install/` between `terminals/` and `harness/` with its three crossings as the table's debt, owned by [[d0e09e2a]]. Done when the table's debt is exactly those three pairs and the server's boundary test and the moved suites pass.
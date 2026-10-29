---
id: 01a12906-9ad0-7a9d-9cef-e7626b7501ba
title: Installation accounting includes the holder, and start acceptance through it is confirmed by system tests
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: symbol
    ref: packages/execution-host/src/ProcessUsage.ts
    symbol: ProcessUsage
---
Add the holder to ProcessUsage as a separate installation process with a pid from HELLO and a ProcessReader witness, without losing the logic's role. Check every acceptance item of the parent task against the current code and run the host's system tests one per own state. Done: the holder's role confirmed by a unit test, each item given paths and rows, checks and remaining gaps named in the result.

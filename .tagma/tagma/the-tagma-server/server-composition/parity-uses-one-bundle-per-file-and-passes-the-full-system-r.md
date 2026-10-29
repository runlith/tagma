---
id: 01a12971-3785-7fc9-9f5d-1a7e940a49fb
title: Parity uses one bundle per file and passes the full system run
ord: 6
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1271e-2479-7971-9b0c-4ec70308b97d
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/parity.stest.ts
  - kind: file
    ref: apps/tagma/server/src/composition/testing/threads/parityWorld.ts
---
Remove the repeated execution-bundle build in the parity fixture, keeping fresh server runtimes for crash and handover; the full `parity.stest.ts` must fit in 60 s, target below 45 s. The managedWorld failures found were fixed in [[42b2b5b0|the related task]]. Deliveries `628a458da9` and `d629465408` keep four transports and the whole matrix: four restart acts instead of sixteen, one bundle per file, each fixture closed plus the crash stack, one recovery recheck for all seats. Final full run: 60/60, 72 assertions, 53.21 s; the below-45 s target is unproven. This is a sample on macOS; the server's full typecheck did not finish checking in 60 s.

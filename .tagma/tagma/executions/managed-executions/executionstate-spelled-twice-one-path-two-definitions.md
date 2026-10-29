---
id: 01a0cad3-a4e6-7373-b037-b37b04abf689
title: "`executionState` spelled twice — one path, two definitions"
ord: 53
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/connection.ts
    symbol: executionState
---
`executionState` is spelled identically — same body — in `terminalsLayer.ts` and `ExecutionHost.ts`. Two answers to where the execution host keeps its state, which stay one answer only by parallel editing.

Done when one of them imports the other (or a shared third place).
---
id: 01a0c72b-21c2-7447-9df2-8cba29e82c9b
title: A child's cost reads only after the child was reaped
ord: 5
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/runtimeCost.ts
  - kind: symbol
    ref: packages/execution-host/src/native/PipeChild.ts
    symbol: runtimeChild
  - kind: symbol
    ref: packages/executions/src/bunSpawner.ts
    symbol: spawn
  - kind: symbol
    ref: packages/executions/src/runtimeCost.ts
    symbol: runtimeCost
---
For a child never reaped the caller answers unknown; an early read is only a lower bound.

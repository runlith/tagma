---
id: 01a13568-7913-73f0-96f8-b83c45c2e267
title: The Completed verdict returns after execution finalization; cancel stays available until drain
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1355d-ee55-71ed-a37f-51060a4afbc0
sources:
  - kind: file
    ref: packages/execution-host/src/registry/operations.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionStop.ts
    symbol: ExecutionStop.ended
  - kind: symbol
    ref: packages/execution-host/src/registry/assembly.ts
    symbol: assemble
  - kind: symbol
    ref: packages/execution-host/src/registry/work.ts
    symbol: finished
---
Leader exit, source EOF and native-resource return are different frontiers. Completed awaits total finalization so the next command never gets refused over already finished work; Cancelled stays available until drain and promises no EOF. Finalization uses a fresh measurement or joins the previously measured stop receipt: no new measurement does not free it from returning resources. Retirement interrupts the worker, so its completion also confirms the end of all scope finalizers; otherwise a Completed waiter would stay unanswered. The record and its readers are held independently of the live slot, so returning space never needs history retirement.

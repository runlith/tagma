---
id: 01a0c712-6de3-731c-91c0-17f661e25fce
title: Reading what the host holds or has already finished starts, finishes and emits nothing
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/Executions.ts
  - kind: symbol
    ref: packages/executions/src/ExecutionClient.ts
    symbol: command
  - kind: symbol
    ref: packages/executions/src/ExecutionClient.ts
    symbol: commands
  - kind: symbol
    ref: packages/executions/src/ExecutionClient.ts
    symbol: hostListeners
  - kind: symbol
    ref: packages/executions/src/ExecutionClient.ts
    symbol: listeners
  - kind: symbol
    ref: packages/executions/src/ExecutionClient.ts
    symbol: processes
  - kind: symbol
    ref: packages/executions/src/Executions.ts
    symbol: ending
---
Inventory, command, process and listener reads observe only. A probe of the world while reading is allowed; an act on the observed execution is not.
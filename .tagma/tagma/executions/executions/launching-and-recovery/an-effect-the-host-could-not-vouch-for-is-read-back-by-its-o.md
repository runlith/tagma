---
id: 01a0c706-57b3-7134-a26a-dbc872f742cc
title: An effect the host could not vouch for is read back by its operation key, not restarted
ord: 4
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/host.ts
  - kind: symbol
    ref: packages/executions/src/protocol/execution.ts
    symbol: HostRequestRef
  - kind: symbol
    ref: packages/executions/src/protocol/host.ts
    symbol: UncertainEffect
  - kind: symbol
    ref: packages/executions/src/protocol/runtime.ts
    symbol: OperationAnswer
---
The retry keeps the operation key; a new key would create a second execution.

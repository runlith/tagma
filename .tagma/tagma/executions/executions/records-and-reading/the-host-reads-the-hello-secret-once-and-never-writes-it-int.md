---
id: 01a0c714-c5dd-7e8e-b691-4a3649257250
title: The host reads the hello secret once and never writes it into the log, the record or the child's environment
ord: 6
tags: ["rule"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/wire.ts
  - kind: symbol
    ref: packages/executions/src/protocol/wire.ts
    symbol: ClientMessage
---

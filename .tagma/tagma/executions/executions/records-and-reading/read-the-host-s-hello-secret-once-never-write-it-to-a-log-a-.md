---
id: 01a0c714-c5dd-7e8e-b691-4a3649257250
title: Read the host's hello secret once; never write it to a log, a record or a child's environment
ord: 6
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/executions/src/protocol/wire.ts
    symbol: ClientMessage
  - kind: file
    ref: packages/execution-host/src/Credentials.ts
---
The secret only authenticates a connection's role in its hello message.
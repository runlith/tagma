---
id: 01a0c71c-fb0d-72da-8df5-7a0362049465
title: Nothing binds a process or socket to an execution by text — not by command line, working directory, or the URL the child printed
ord: 1
tags: ["rule"]
sources:
  - kind: file
    ref: packages/execution-host/src/ProcessEvidence.ts
  - kind: file
    ref: packages/execution-host/src/processTree.ts
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: ListenerHint
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: ProcessAssociation
  - kind: symbol
    ref: packages/executions/src/protocol/evidence.ts
    symbol: ProcessSnapshot
---
Associations derive from kernel tables, the socket owner from the sockets table; the record text serves only the reader.

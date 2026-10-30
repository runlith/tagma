---
id: 01a0c71c-fb0d-72da-8df5-7a0362049465
title: Bind a process or socket to an execution only from kernel tables, never from command text, working directory or a URL the child printed
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
---
Associations derive from the process tables and a socket's owner from the sockets table. A printed URL (`ListenerHint`) is a hint for the reader only.
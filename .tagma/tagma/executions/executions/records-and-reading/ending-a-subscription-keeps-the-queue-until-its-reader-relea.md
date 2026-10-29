---
id: 01a12c8e-4364-7be4-bf83-7a8727b80708
title: Ending a subscription keeps the queue until its reader releases it
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c87-3ce1-77a1-b29c-cb5e536ffde9
sources:
  - kind: file
    ref: packages/executions/src/WireReaders.ts
  - kind: symbol
    ref: packages/executions/src/ExecutionClient.ts
    symbol: ExecutionClient
---
The host may send Subscribed, all output, and Ended in a single socket read while the caller is still waiting for the open answer. A finished queue stays addressable until the reader's close; credits past Ended are not returned. Otherwise acquisition loses already accepted bytes and the ending of a short command.

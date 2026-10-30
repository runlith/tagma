---
id: 01a0c721-9298-729d-8e93-5ec4c80af5c5
title: Only the quiescence ticket that Quiesce answered reopens admission
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/executions/src/protocol/runtime.ts
  - kind: symbol
    ref: packages/executions/src/protocol/runtime.ts
    symbol: QuiescenceTicket
  - kind: symbol
    ref: packages/executions/src/protocol/runtime.ts
    symbol: ResumeAnswer
---
The host compares the opaque ticket with the one it issued for that quiescence; a resume under any other ticket answers `TicketUnknown` and never lifts the fence. A fence that shutdown won is final and never opens.
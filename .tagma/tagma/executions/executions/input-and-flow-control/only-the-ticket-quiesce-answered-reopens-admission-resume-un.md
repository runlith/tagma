---
id: 01a0c721-9298-729d-8e93-5ec4c80af5c5
title: Only the ticket quiesce answered reopens admission; resume under any other never lifts the fence
ord: 5
tags: ["rule"]
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
A fence that shutdown won is final and never opens. The host compares the opaque ticket with the one issued for that quiescence.

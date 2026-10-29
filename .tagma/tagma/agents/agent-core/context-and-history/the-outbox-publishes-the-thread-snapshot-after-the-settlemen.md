---
id: 01a16fc9-c099-7e00-a6d4-1c880905b9a6
title: The outbox publishes the thread snapshot after the settlement confirmation
ord: 12
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16fc4-3684-79e6-bea8-3e2163aa39e1
sources:
  - kind: file
    ref: packages/agent/src/thread/run/endingDrive.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadSettlementOutbox.ts
    symbol: ThreadSettlementOutbox
---
The outbox publishes the thread snapshot after the settlement confirmation.

A frame from a settlement subscriber can leave before durable confirmation: for an end inside someone else's transaction the outbox works in background, and the transport's final frame can also overtake it. So the confirmation itself triggers the snapshot publication. The publication binding stands beside the ending runner: the outbox sits below the snapshot owner and does not import it.

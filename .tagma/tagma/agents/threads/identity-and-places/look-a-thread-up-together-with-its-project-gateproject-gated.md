---
id: 01a0cab7-2b9f-73bb-8808-00c130cfaf9e
title: Look a thread up together with its project (`gateProject`, `gatedByProject`); never test that a thread id exists on its own
ord: 1
tags: ["rule"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/birth/projectGate.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/projectGate.ts
    symbol: ownedProject
---
A thread is addressed only through its home project; a caller from another project is refused with `ThreadRefused`.
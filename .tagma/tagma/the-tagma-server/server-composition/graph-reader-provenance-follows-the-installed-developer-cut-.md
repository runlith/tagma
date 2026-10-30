---
id: 01a18a4e-dc04-7b76-b21b-61613e8f6c17
title: Graph reader provenance follows the installed developer cut, not its checkout's current HEAD
ord: 40
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a116e0-5bba-787e-8220-cf400da4b4f7
sources:
  - kind: symbol
    ref: apps/tagma/server/src/composition/runtime.ts
    symbol: makeRuntime
---
A checkout can move after its server was built, while builtin inspections and reflection filing still execute the installed code. Graph readers therefore use the developer installation's recorded build revision when no direct-checkout provenance exists; that does not make the installed process a checkout server. A release without a recorded source checkout provides no checkout revision.
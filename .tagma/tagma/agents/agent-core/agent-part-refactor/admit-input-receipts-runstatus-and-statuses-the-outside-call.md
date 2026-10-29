---
id: 01a11901-5360-733e-9ca2-9122d46485b4
title: admit, input receipts, RunStatus and statuses; the outside caller at Tagma doors
ord: 20
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cce9f3bb3f9
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911ed3c0852f
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9121a7add807
---
Implements [[9f3bb3f9]]. Start with `ThreadIntrospection.ts`, `ThreadSignals.ts`, `thread/keyed.ts`, Tagma `threads/contract/wire/feeds.ts`.

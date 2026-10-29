---
id: 01a16160-3b5a-73b2-a5fd-0b503d722a2a
title: Navigation engine holder on the server and the definition and uses operations
ord: 23
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16167-af2e-7642-afb4-68ae2d214648",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
  - kind: waits-on
    to: 01a16160-10e4-70a6-b29a-fe8035b3ac59
---
A server module: an engine lease on a `RootId`, lazy start and a "loading engine" answer, generation change on crash, a checkout question queue with cancellation, subscription to `CheckoutWatch.follow` and `CheckoutRows.headMoved`, agent writes delivered to the answer, machine memory and CPU budget with eviction plus a working driver, engine-state reading; the `definition` and `uses` operation manifest with its pages and voice, and the TypeScript adapter wiring in composition. Written against the navigation kit contract; the engine process comes from the adapter task, until then from a fake adapter.

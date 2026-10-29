---
id: 01a14066-bbdc-7c20-ba63-2356ba41222e
title: Migrate the ThreadEnvelopes tests to scoped Effect and honest inbox ports
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/collaboration/ThreadEnvelopes.test.ts
---
Migrate `collaboration/ThreadEnvelopes.test.ts` to it.effect with a test scope, event-driven rendezvous and TestClock; keep the public delivery contracts, owed requests, final/replay, waits and failures, remove copy and bookkeeping. Replace the local ManagedRuntime and partial faces with full tagged contracts, verify the file with a serial test, file-scoped typecheck and check_law, then land. By the parent's assignment, one review round runs at the package's end, not after this file.

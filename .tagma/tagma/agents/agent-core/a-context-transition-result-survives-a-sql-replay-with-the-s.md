---
id: 01a12779-8061-7849-aab0-e01fcc636df1
title: A context-transition result survives a SQL replay with the same types and no full-history copy
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523f-7ee2-9537-e8014a4925bd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12712-5dd8-76d3-b854-53ad1fdb786a
sources:
  - kind: file
    ref: packages/agent/src/thread/run/assembly/RunAssembly.ts
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/runs/transitionStore.ts
    symbol: NativeTransitions.lookup
---
The context-transition result survives a SQL replay with the same types and no full-history copy.

`RunAssembly.oriented` returns a full `ThreadRow` with history, and the SQL receipt serializes it to JSON. On replay `NativeTransitions.lookup` returns a plain JSON object, and the kernel casts it to `A`: `createdAt`/`updatedAt` are already strings, while the consuming `RunAssembly.native` gets a `ThreadRow` with `Date`. This predates the accounting change as a result-boundary defect; the memory receipt hides it. At the context-transition owner, pick the minimal portable result its caller needs and decode it on the real SQL boundary. Prove it with a public context transition with answer loss and replay: result data and types survive, and no unneeded history is copied into the receipt.

Delivered in `851acadd3a0`: the context receipt stores `null`; an ordinary commit returns the decided snapshot, and SQL replay restores the row through the store. SQL context test and loss/reopen sequence test: 2 pass, 33 assertions; agent package typecheck and 17 applicable rules clean. The full server typecheck stopped at 61 errors in six unrelated external-harness/composition files. On a real history of 1336 messages, serializing the history copy (4.63 MB) cost 8.85–12.81 ms CPU against ≤0.004 ms for the 15-byte receipt; this is a serializer micro-measurement, not proof of running-server CPU savings.

---
id: 01a14029-3fba-7fe0-900d-4dfa498dcfee
title: Migrate HookDelivery and dispatch to Effect
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/delivery.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/testing/hookDelivery.test.ts
---
The second part of hooks/: replace the HookDelivery service class with make closures, migrate dispatch to Effect.fn, Clock and FileSystem, and update the direct consumers of the delivery shape. Keep separate road/reserve budgets, single-shot finish, retry conditions, wire refusals, spans, diagnostics within one capturedAt and the refused entries' witnesses. Migrate the hookDelivery tests to effect-test with minimal ownership proofs. Leave the budgets and cold admission from [[e057eae7|the separate task]] alone; do not mix base/pendingWrites into this delivery without a necessary contract change. HookDelivery and its consumers are recorded in 39f60f0e3b, dispatch in d4d41880fa. Dispatch: production 539→535 nonempty lines, effect-style 19→0; hookDelivery 9/21, hookWrites 9/57, adoption 2/14; narrow bun check — 0 errors in 502 files, check_law — 17 rules with no violations. One review round finished with no findings. The full package check was not repeated on the parent's instruction because of the external storage/conformance migration; the new cold-admission defect was not fixed. Diff and spans accepted by the parent before recording.

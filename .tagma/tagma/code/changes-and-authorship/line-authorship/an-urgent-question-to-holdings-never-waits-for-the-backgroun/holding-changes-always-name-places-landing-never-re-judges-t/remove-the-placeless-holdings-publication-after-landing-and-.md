---
id: 01a14c4e-7d20-7f6a-b9ef-01dc3d1499d2
title: Remove the placeless holdings publication after landing and the full re-judge in judgedChange
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c20-33ed-7ba1-8f9f-0c865b054f35",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c4e-7d20-7f6a-b9ef-01d723424bc6
---
Build [[23424bc6]]: remove the placeless holdings publication after landing (the `HeldRows` port and its wiring), the `threadMoved` and `touched`-by-`rootId` branches in `judgedChange`, and `ThreadRows` in the call context when it has no readers. Make `HeldChange.moved` required.

Start from `landing/land/submit.ts#discharged`, `landing/landing.ts`, `composition/callLifetimes.ts`, `composition/http/handlers.ts`, `native-harness/turns/context.ts` and `holdings/judges.ts#judgedChange`.

Proof: typecheck, green landing and retirement itests, and after `submit_work` only `Holdings.judge` batches over departed lines' places in telemetry.

## Result (44c688f930)

The `HeldRows` port with its wiring, `threadMoved`, the `touched` branch in `judgedChange`, and the `rootId` field on `HeldChange` that only it read are removed; `moved` is required. `ThreadRows` had no readers and is removed; `announceThread`/`markHeld` in `ThreadList` are now methods. Typecheck is clean in the touched files; 399 change-record, landing and threads tests plus their itests are green.

Not verified: telemetry of a live server after `submit_work` — only the operator builds with this change. That only batches over places survive after landing follows from code: `judgedChange` no longer has a placeless branch.

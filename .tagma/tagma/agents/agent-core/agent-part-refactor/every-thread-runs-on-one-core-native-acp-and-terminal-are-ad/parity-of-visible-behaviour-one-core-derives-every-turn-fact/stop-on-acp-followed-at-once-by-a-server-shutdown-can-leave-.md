---
id: 01a14d27-43b7-7f10-8069-125e71bd222c
title: "Stop on ACP followed at once by a server shutdown can leave the vendor turn open: the next words never go to the agent"
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01b6-73d1-ab67-0e20a204ca15",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14cf8-62c0-75f1-8452-7c20da3af7a3
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/reactor.ts
---
Observed (one run in `protocolStops.stest.ts`, scripted agent): a Stop with withdraw answered `stopped`, the core run became `withdrawn`, and right after the test closed the driver scope (a clean server handover). The next driver accepted words, but `session/prompt` never went to the agent, and by `withdrawn` the agent's report had no `session/cancel` yet. When the test waited until the protocol row had no open turns, everything passed.

An external run's stop ends at the core at once (`RunExecution.halt` → `lifecycle.stop`), while the `Cancel` goes to the agent after: `ProtocolInputs.cancelled` writes `cancelling: true`, `ProtocolReactor.reconciled` places the `Cancel`. Assumption, unverified: if the server leaves between writing the `Cancel` intent into the client machine (the prompt request marked `cancelled`) and writing the frame, the next driver sees `cancelled` and never sends `Cancel` again, while the vendor's open turn holds `prompting(row)`. That covers a plain Stop too, not only withdraw: before da3af7a3 withdraw itself waited for the vendor turn end, so the window was visible only on a plain Stop.

Start by reproducing: Stop and an immediate driver-scope close with no wait, then words on a new driver. Proof — a system test where the next words reach the agent, and the fix at the owner delivering `Cancel` after a restart.

## Outcome

Commit 275dbb3352. Cause — two windows in which the vendor turn stays open and nobody sends `Cancel` after a restart: the core stop arrived while no server owned the turn (`interrupt` found no link), and a durable-recorded `Cancel` whose bytes the agent never got (`reconciled` skipped an already-cancelled prompt). Fix: `ProtocolProcess` on the `Recovered` step of the same process sets `cancelling` when the prompt is cancelled or the core run of the row's turn is no longer `running`, and `ProtocolReactor.reconciled` sends `Cancel` on any open turn. Proven by two tests in `protocolStops.stest.ts`, each red without its own half of the fix.

Not proven: a `stopRequest` stop recorded after the new owner took the turn follows the old heartbeat → `interrupt` road and is not covered by a separate test.

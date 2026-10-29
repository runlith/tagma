---
id: 01a1525e-308c-751e-ba13-682031623d02
title: "Split SessionDriver: launch and print, lease and recovery, session leading live in one drive.ts"
ord: 33
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-6ae2-72a7-8565-b02edaf63602",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09e05d158760
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/sessions/drive.ts
---
`external-harnesses/sessions/drive.ts` crossed the 650-row ceiling of rule 6b3210c7 (658 rows) with the lazy raise of terminal sessions ([[5d158760]]). The `SessionDriver` class holds several subjects: launch, readiness and word printing (`launch`, `seat`, `ready`, `type`), stopping (`stop`, `stopExecution`, `finish`), lease and post-start recovery (`recover`, `raise`, `takeUp`, `raisedAtEnd`, `takeOverAtExpiry`, `beat`, `beating`) and live-session leading (`attend`, `drive`, `driveAdopted`). `attend` and the `driven` map bind them, so that work had no clean split.

Do: move the lease and recovery (or another subject that comes out cleanly) into its own file in the `sessions/` module, so drive.ts holds one subject; the F4 debt on drive.ts is removed.

Done (`7e317d2824`): lease and recovery moved to `sessions/lease.ts` (`SessionLease`: start, raise, expiry takeover, lease beat and waiting on `driven`/`booted`); `SessionDriver` holds launch, print, stop and live-session leading and exposes the lease as `lease`. The `SessionDriver.recover`/`SessionDriver.beat` span names are kept. The F4 debt on drive.ts is removed by remeasurement (debt 14 → 13). Fixed along the way is a lazy-raise defect from `16b561c5d4`: the first hook raised any session, and a processless session went to launch or "gone" (`hookReport.stest` "all five hook vocabularies…" failed); now the hook raises only a `running` session with an execution (`SessionLease.heard`). The measurement for [[5d158760]] is recorded in its own ending; the startup test counts statements equal on 10 and 40 idling, counting only spans under `SessionDriver.recover`. Checks: `terminalDelivery.stest` 13/13, `terminalCore` 8/8, `terminalProof` 5/5, `terminalWatch` 6/6, all `cli/hook*.stest` green, typecheck clean on files. Review: one P2 (the counter captured SQL of background `rearm` timers) — fixed.

Proof: `terminalDelivery.stest`, `terminalCore`/`terminalProof`/`terminalWatch` itests green, the debt of rule 6b3210c7 on drive.ts is gone.

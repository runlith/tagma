---
id: 01a11901-5360-733e-9ca2-9121a7add807
title: "RunLifecycle: run transition contract, durable endings, settlement delivery with a cursor"
ord: 19
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2ccf7e9130bd
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911ed3c0852f
---
Implements [[7e9130bd]]. Start with `ThreadRunLease.ts`, `ThreadRunReaper.ts`, `ThreadRunLedger.ts`, `ThreadSettlementOutbox.ts`, the Tagma `native-harness/runs/`.

Delivered: 5d5109ce00 (signals), a413208d3e (RunLifecycle/RunExecution, stop request as act, admission as service, ModeLaw, ApprovalParking; ThreadRunLease removed), 74c4af3ed5 (SQLite stop_request, batched heartbeats, shared RunAdmission in Tagma), c515e9a415 (stop_request migration), 1b4e1ee933 (per-subscriber cursor, `notification-exhausted`, redeliver, `endings`/`latest`, `delivered` migration, migration test), 60a24a031e (lifecycle conformance rows).

Proven: conformance on both adapters — keyed replay, stop/complete race, two opens, handover→adopt without a resume count, abandoned→adopt with a count and exhausted→cut, reaping own stale as `failed`, parked untouched by adopt/cut/reap, heartbeat without a count, durable progress resets it, recorded stop, endings paging/latest/redeliver; unit — settlement (first subscriber not called twice, lost acknowledgement, exhausted visible in endings and cleared only by redeliver), reaper resume-failed vs ownership-lost, admission isolation of two harnesses; Tagma migration test: parked run and unacknowledged delivery across migrations. The 650-line debt on `ThreadRunLease.ts` is cleared.

Second round (from review), delivered: ea00c37427, f05165c0cd; this round's `RunLifecycle.ts` and `storage/runs.ts` landed whole in fc4af0240a (another session's commit).

Proven in the second round:
- heartbeat by registration: RunExecution.test, "a run resumed by an answer keeps beating".
- Stop:
  - the request is written before abort, and on write failure abort still happens (RunExecution.test);
  - merge runs inside the write, and park/resume/adopt/reap respect a standing stop (conformance `storagePort/lifecycle` and `runLifecycle` on memory and SQLite).
- Settlement:
  - claim-lost stops the next subscriber;
  - claim takes a fresh identity, redeliver works only for exhausted;
  - exhaustion after a crash on the last attempt is recorded in activity once (ThreadSettlementOutbox.test, conformance endings).
- Re-closing publishes nothing twice, and a second stop answers `not-running` (RunLifecycle.test, conformance `runLifecycle`).
- A crash window between effect and ack yields one effect: `settlementRestart.itest`. `runLifecycleMigration.itest` now checks that a subscriber effect is not repeated.
- Keyed replay answers with the pre-admission value, KeyReused has its own tag, NULL digest is not a reuse.
- State × act table:
  - finish refuses parked;
  - reap refuses a non-stale selector and live;
  - stop/complete race through `RunLifecycle` over SQLite.
- Cost: `endedRuns.itest` shows only SEARCH by index and no TEMP B-TREE for page/latest/runById/runByStartKey by EXPLAIN QUERY PLAN.
- Deep ending pages are a keyset seek `(finished_at,id)<(?,?)` over `thread_run_ended_idx` (5e32475eca; plan checked in `endedRuns.itest` on a deep-history page).
- `redeliver_ending`: project-gated operation, checked in `externalCaller.itest`.
- ApprovalParking deadline races with release (red→green in ApprovalParking.test).
- The startingRuns leak in reaper resumeFailed is fixed.

Not proven / open:
- The `redelivering` branch of `redeliver_ending` is checked at the port and in the outbox, but not through the door.
- A cross-process parked run by design ends a prepared-approval tool with a refusal after migration.

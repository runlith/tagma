---
id: 01a12712-5dd8-76d3-b854-53ad1fdb786a
title: Run-transition accounting keeps only what a retry can read, and does not outlive the run
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12712-ddd2-7f9b-bdf0-2921088b00ff",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-4224d802b89f
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79efc3af42eb
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261010183425_run_transition_receipt/migration.sql
  - kind: file
    ref: apps/tagma/server/src/native-harness/maintenance/transitions.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/runs/transitionStore.ts
  - kind: file
    ref: packages/agent/src/thread/transition/sequence.ts
---
`thread_run_transition` holds 12.5 GB of 23.1 GB in a copy of the operator's database: 654,601 rows, one transition answer up to 23 MB. This is the idempotency accounting for run transitions — the request digest and the answer for a retry; it is written on every transition (`native-harness/runs/transitionStore.ts`, `record`) and never deleted.

What to do:

- **Determine by code which retry is possible.** `lookup` answers `present` on a `seq ≤ applied` retry and fails with an invariant when no record exists. Who sends `seq ≤ applied`, and when: nobody, only the last applied one, or an arbitrary one.
- **Store exactly that.** Nobody — no table and no retry branch, only `applied_seq` on the run. Only the last one — a single record per run, replaced by the next transition. Arbitrary — as today. In every case the accounting of a finished run is deleted with its end, and a request to a finished run gets a defined answer, not an invariant.
- **Delete what accumulated, once.** Measured on a cold-cache database copy: only what fits the window budget goes into database opening; the rest in portions after start, awaited by no human operation.

Delivery `6d5e548d49fd264989c6c782f66d5af4f96389b7` keeps one receipt of the running run and deletes it with its end, preserving the historic `applied_seq`; the retry contract is explained in the [[582d8349|owner note]]. The migration moves the readable result with an index seek and renames the accumulated accounting for background draining. A snapshot covering the rename forbids draining until released; exact restore, readonly reads outside the writer, deletion, and reopen are proved by a short contract test. Memory/SQLite conformance, kernel, wire refusal, and write-set checks passed; scoped TS over 13 native/boundary, 5 storage, and 15 agent files finished with code 0. Responsiveness on the large copy is not proved: on a warmed row of 4.75 MB DELETE cost 3.28 ms, COMMIT 28,929.93 ms; a small portion reached 185.55 ms. The general cause of WAL servicing is handed to the SQLite owner in [[9ae1db7b|handoff task]]; the drainer's local checkpoint PRAGMAs were unchanged. Full draining and the final opening of the large copy by a real backend were not run here; that proof remains in [[2d1f5572|update rehearsal on a clone]].

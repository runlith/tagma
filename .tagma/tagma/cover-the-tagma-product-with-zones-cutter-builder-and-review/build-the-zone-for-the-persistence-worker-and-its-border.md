---
id: 01a0c83d-befc-7250-b4e5-c45ea65a638d
title: Build the zone for the persistence worker and its border
ord: 89
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/performance/src/store/worker.ts
  - kind: file
    ref: packages/performance/src/StoreWorker.ts
---
Wave 1, builder: [[d4b6f6d5]] of [[2a74de70]] — `src/StoreWorker.ts` (140), `src/worker.ts` (253). Read both whole, and the request and response unions in `PerformanceStore.ts` that cross between them.

Leads: the three declared bounds and the measurements behind them, including the one open step with no bound of its own; the backoff after consecutive failures and what makes a generation stable; why a flush crosses as a transferable buffer; one command at a time and what that costs a slow read; ending the worker on a failure instead of reporting one, and what closing the scope rolls back; a corrupt row told apart from a store that has stopped; the insert chunk; the worker's own memory reading, with and without a collection.

The request and response types are owned by [[939c126c]] and the ring by [[2fb06b87]]; claim over this border, not over theirs.

Done when the claims stand verified, `run_doctor` over both files is clean and the review passes.
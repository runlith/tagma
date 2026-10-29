---
id: 01a0c83d-bef3-7371-bac3-d3b1cf43ded9
title: Build the zone for submission and the pending bound
ord: 88
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
    ref: packages/performance/src/PendingQueue.ts
  - kind: file
    ref: packages/performance/src/RetentionGroups.ts
  - kind: file
    ref: packages/performance/src/store/store.ts
---
Wave 1, builder: [[939c126c]] of [[2a74de70]] — `src/PerformanceStore.ts` (1,282), `src/PendingQueue.ts` (287), `src/RetentionGroups.ts` (41). Read all three whole.

Leads: a record is encoded once, at submission, and never looked at again; the two buffers and which one the bound sheds first; what a shed writes as a record and what an account keeps when there is no store left to write to; `submit` against `submitDurable`; `pressure()` rotating the interval peak where `diagnostics()` does not; the flush clock against the byte ceiling; the retention group as a depth per key, released exactly once; the services a failed open still answers with.

The worker handle's timeouts and replacement belong to [[d4b6f6d5]], the reports to [[1f61148e]]: this area owns what happens on the measured side before the bytes cross.

Done when the claims stand verified, `run_doctor` over the three files is clean and the review passes.
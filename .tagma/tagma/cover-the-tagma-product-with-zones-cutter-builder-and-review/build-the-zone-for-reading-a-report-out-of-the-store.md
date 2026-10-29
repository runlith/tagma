---
id: 01a0c83d-bf07-7525-b15a-c308b7cd6b07
title: Build the zone for reading a report out of the store
ord: 91
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
    ref: packages/performance/src/PerformanceReports.ts
  - kind: file
    ref: packages/performance/src/StoreReports.ts
---
Wave 1, builder: [[1f61148e]] of [[2a74de70]] — `src/StoreReports.ts` (2,182) and `src/PerformanceReports.ts` (75). The largest area of this package and the one file worth reading in passes: the shared machinery first — the fan-out, the point read, the time page and its conditions, the report meta — then each fold on its own.

Leads: why a page can merge segment answers without re-sorting; what decides how many files a question opens; the metric arithmetic — compatibility between consecutive readings, what a reset or a boundary change does to a delta, and why a percentile stays absent on no observations; the overview's sample budget and the partial reasons it reports; the load bucket's nulls that are never zeros; the stall reading's frames and its callers, and why the tighter span is the better answer; the trace walk and the breakdown's self time; what a miss carries; a report that timed out being neither a broken query nor a stopped store; the losses page the worker cannot finish and the store completes.

Claims here take symbol sources on this file — `readOverview`, `readMetricHour`, `readLoad`, `readStall` and their kin — so the folds are covered at the resolution of one fold each. Nobody else claims over this file: if a fold's contract also binds a producer, bind that producer's file beside the symbol here rather than moving the claim.

Done when the claims stand verified, `run_doctor` over both files is clean and the review passes.
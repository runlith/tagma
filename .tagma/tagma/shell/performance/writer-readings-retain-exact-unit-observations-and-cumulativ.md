---
id: 01a18f5e-7690-7790-a772-5da6bbd423fa
title: Writer readings retain exact unit observations and cumulative operation histograms separately
ord: 45
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/WriterMetrics.ts
  - kind: file
    ref: packages/performance/src/PerformanceReports.ts
  - kind: file
    ref: packages/performance/src/protocol/queries.ts
  - kind: file
    ref: packages/performance/src/protocol/reports.ts
---
Writer units are process-local physical outer Store units, measured independently of span sampling or a causal ledger. Their root id and operation identify the causing unit; a nested join has no separate physical observation. Unit rows retain a bounded suffix, with instance-bound cursors, explicit reset, conservative gap and cumulative eviction counts. Operation histograms outlive row eviction but retain a bounded set of names; eviction and recreation give a name a new series. Interval subtraction requires the same writer id, operation series and bucket boundaries, and counts must be compared at the reported unit cursor. Histogram p50/p99 are bucket upper bounds, or an above-last-bound result, never interpolated exact durations. Child elapsed includes preparation, binding, SQLite lock/engine work and result materialization in the writer, not engine CPU. Missing child replies or an inconsistent clock split leave child and outside durations unknown and exclude them from those two histograms; physical wait and hold remain observed. The execution-host ring cannot answer these readings.
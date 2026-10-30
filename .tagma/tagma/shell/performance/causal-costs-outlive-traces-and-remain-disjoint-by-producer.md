---
id: 01a18f1d-99e6-7406-b7e7-138631516db8
title: Causal costs outlive traces and remain disjoint by producer
ord: 43
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/CostLedger.ts
---
Causal counters travel independently of trace ancestry so a root can receive after-commit and callback work after its own effect ends. A cause selects one bucket; totals are read from the root's own bucket plus its memoized producer buckets, so nested producers never add the same work twice. Callback capture carries only the cause, not the invoking fiber's context or trace. The process retains a bounded suffix of roots and reports cumulative eviction; an evicted cause may finish, but its late work does not reinsert it. This is process-lifetime evidence, not durable history, and byte counters describe logical SQLite payloads rather than transport framing.
---
id: 01a0c83d-bf0d-7cfd-bf78-67c80e37812b
title: Build the zone for spans, their sampling and their histograms
ord: 92
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
    ref: packages/performance/src/MetricSnapshots.ts
  - kind: file
    ref: packages/performance/src/PerformanceTracer.ts
  - kind: file
    ref: packages/performance/src/TraceSampler.ts
---
Wave 1, builder: [[d6c0265b]] of [[2a74de70]] — `src/PerformanceTracer.ts` (412), `src/TraceSampler.ts` (279), `src/MetricSnapshots.ts` (89). Read all three whole.

Leads: the four reasons a trace is kept and the order they are read in; the hash keep, and why the same id answers the same in every process; the two bounds on holding an undecided trace; slow read off the name's own running distribution and the absolute root ceiling nothing hides under; the attribute allowlist and what a dropped span is spared; the record floor applying only to a trace kept on its id alone; one retention group per kept trace rather than one per span; why the sampler is a reference with a default instead of a service one sibling provides to the other; the snapshot writer selecting exactly the histograms and counters the tracer declares, and the finalizer that writes a last snapshot before the process goes.

What a report does with those metric records is [[1f61148e]]'s; the stall the sampler is told about is [[d115a499]]'s.

Done when the claims stand verified, `run_doctor` over the three files is clean and the review passes.
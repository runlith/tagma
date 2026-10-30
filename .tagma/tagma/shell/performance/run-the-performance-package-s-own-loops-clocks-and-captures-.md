---
id: 01a0c83d-bec1-7b36-962d-378f94977ffb
title: Run the performance package's own loops, clocks and captures with the tracer disabled
ord: 7
tags: ["rule"]
sources:
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
  - kind: file
    ref: packages/performance/src/CpuProfiles.ts
  - kind: file
    ref: packages/performance/src/HeapSnapshots.ts
  - kind: file
    ref: packages/performance/src/LoopStalls.ts
  - kind: file
    ref: packages/performance/src/MemoryCaptures.ts
  - kind: file
    ref: packages/performance/src/MetricSnapshots.ts
  - kind: file
    ref: packages/performance/src/ProcessVitals.ts
  - kind: file
    ref: packages/performance/src/store/store.ts
  - kind: file
    ref: packages/performance/src/StoreWorker.ts
---
The sampler loop, flush, profile cut and capture go through `Effect.withTracerEnabled(false)`. Exceptions: the tracer itself, a worker without a tracer, and a report door traced as the product's own work.
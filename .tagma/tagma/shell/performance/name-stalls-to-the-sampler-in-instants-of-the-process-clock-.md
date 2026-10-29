---
id: 01a0c84e-184c-70f8-a597-40d56e6841ec
title: Name stalls to the sampler in instants of the process clock it was built with
ord: 20
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/performance/src/MetricSnapshots.ts
  - kind: file
    ref: packages/performance/src/PerformanceTracer.ts
  - kind: file
    ref: packages/performance/src/TraceSampler.ts
  - kind: symbol
    ref: packages/performance/src/TraceSampler.ts
    symbol: coverStall
---

---
id: 01a0c853-85f5-7887-9c70-64463c619e8d
title: Mount at most one profiler layer per isolate
ord: 17
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/performance
  - kind: symbol
    ref: packages/performance/src/CpuProfiler.ts
    symbol: CpuProfiler
  - kind: symbol
    ref: packages/performance/src/CpuProfiler.ts
    symbol: make
---
A second driver would stop a profiling window it never opened. A host without a profiler binds `CpuProfiler.none`.
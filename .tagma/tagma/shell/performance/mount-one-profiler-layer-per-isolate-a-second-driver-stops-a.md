---
id: 01a0c853-85f5-7887-9c70-64463c619e8d
title: "Mount one profiler layer per isolate: a second driver stops a window it never opened"
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
A host without a profiler binds CpuProfiler.none.

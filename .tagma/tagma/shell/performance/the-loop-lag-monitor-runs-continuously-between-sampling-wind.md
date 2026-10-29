---
id: 01a16e6d-a2e5-7580-aee5-3190fd2e52b9
title: The loop lag monitor runs continuously between sampling windows
ord: 34
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/ProcessVitals.ts
---
In the [Bun timer](https://github.com/oven-sh/bun/blob/c6da4a4d3/src/runtime/timer/mod.rs) re-enabling resets the previous tick moment, so the first lag after it has no baseline to compare against. Resetting the histogram between windows keeps that moment; stopping belongs to scope close, otherwise a block right after the previous window's write disappears from metrics. Histogram bounds, CPU, and the monotonic interval change before the publication and the memory-ceiling handler: the handler's lag belongs to the next window, otherwise its maximum comes out longer than the interval itself.

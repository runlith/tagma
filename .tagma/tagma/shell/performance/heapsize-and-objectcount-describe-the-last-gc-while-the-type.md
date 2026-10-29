---
id: 01a16e53-927f-716f-9a8e-d3c60b6bdff2
title: "`heapSize` and `objectCount` describe the last GC, while the type census sees new cells"
ord: 33
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/MemoryCaptures.itest.ts
  - kind: file
    ref: packages/performance/src/MemoryReading.ts
---
In the [Bun contract](https://bun.sh/reference/bun/jsc/HeapStats) the first two counters cover what survived the last collection, while `objectTypeCounts` includes what was allocated after it. So zero growth in the total object count without a GC does not refute positive growth of one type. A test of a known retained growth runs GC before both snapshots instead of relying on a chance collection during allocation.

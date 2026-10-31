---
id: 01a1903a-8d0e-799a-b01a-56bd8e34c4fc
title: Retain snapshot writer-retry evidence in performance traces
ord: 46
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a18f17-c40e-7223-a9df-7b9b177a82c5
sources:
  - kind: file
    ref: packages/performance/src/PerformanceTracer.ts
---
`ThreadSnapshots.cut` annotates a writer-held retry with `writersHeld`, but `PerformanceTracer` projects only allowlisted attributes and has no mapping for it. Determine the full affected trace contract and retain the signal so a `read_performance` trace can distinguish a snapshot that retried under the writer; prove it through the relevant public evidence path.
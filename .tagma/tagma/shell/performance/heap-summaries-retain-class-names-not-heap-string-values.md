---
id: 01a1854b-343b-7281-86b3-550bdca78778
title: Heap summaries retain class names, not heap string values
ord: 42
tags: ["explanation"]
sources:
  - kind: dir
    ref: packages/performance/src/heap
  - kind: file
    ref: packages/performance/src/HeapReader.ts
  - kind: file
    ref: packages/performance/src/HeapSummary.ts
---
The reader opens a fresh worker for each file; its lifetime ends with the read or interruption, leaving scheduling to the caller. Only object and native node names enter class aggregates; other node types use fixed categories because their names may contain application data. Detached counts include native nodes explicitly marked detached by V8, without propagating state through edges; snapshots without detachedness report zero. Metadata must precede nodes and strings must follow them, as V8 serializes them. Malformed files and worker failures return static reasons without source excerpts. Report reads compare against a validated full-summary sidecar, write the new full baseline atomically and return only the requested self-size and positive-growth rows; absent baselines leave deltas null. Sidecar parsing, class comparison, sorting and JSON writing stay in that worker so the mounting loop never processes the full table.
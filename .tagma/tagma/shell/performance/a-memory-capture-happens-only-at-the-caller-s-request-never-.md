---
id: 01a0c85c-4adb-71ac-b82d-3507317c5c79
title: A memory capture happens only at the caller's request, never on an interval the tool sets for itself
ord: 21
tags: ["rule"]
fields:
  {
    "enabled": true
  }
sources:
  - kind: file
    ref: packages/performance/src/HeapSnapshots.ts
  - kind: file
    ref: packages/performance/src/MemoryCaptures.ts
---
The record and the snapshot carry requestedBy — the one who requested the capture.

---
id: 01a14c05-9e8f-7c75-a633-b2b2e5442353
title: An agent compares memory makeup and takes a heap snapshot to find holding objects
ord: 3
tags: ["feature"]
fields:
  {
    "state": "partial"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b1df27ae3e
sources:
  - kind: file
    ref: apps/tagma/server/src/performance/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/performance/operations.ts
  - kind: file
    ref: packages/performance/src/HeapSnapshots.ts
  - kind: file
    ref: packages/performance/src/MemoryCaptures.ts
  - kind: file
    ref: packages/performance/src/reports/memory.ts
---
**Value.** An agent compares memory makeup between measurements and takes a heap snapshot with retaining references to hunt a leak.

**How.** `capture_memory_reading`, memory/captures/growth readings via `read_performance`, `capture_heap_snapshot`; a `.heapsnapshot` file opens in Chrome DevTools.

**Behaviour.** Census keeps main and store-worker; a separate request may collect garbage and keep an extra reading. Growth compares kept censuses. One main-isolate heap snapshot at a time is taken and kept as a bounded file set.

**Limits.** The feature is partial against its own operation description: it promises GC before census, but the source reading is taken before GC, kept separately after it, and growth compares exactly the source readings. Walking the heap and the snapshot stop the loop and need extra memory. This is on-request diagnostics, not a periodic heap monitor and not a built-in snapshot viewer.

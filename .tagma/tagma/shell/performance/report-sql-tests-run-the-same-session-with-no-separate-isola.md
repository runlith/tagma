---
id: 01a16e34-445b-7a6d-9e7b-50561077940d
title: Report SQL tests run the same session with no separate isolate; memory and loop lag are checked on a real worker
ord: 32
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/store/session.ts
  - kind: file
    ref: packages/performance/src/testing/worker.ts
  - kind: symbol
    ref: packages/performance/src/store/store.ts
    symbol: PreparedStoreWorker
---
The session owns the real ring and request handling; moving it into the test process removes the repeated worker load while keeping the client protocol, serialization, and SQL. A prepared worker is substituted by composition through the existing prewarm port. A local transport proves neither separate memory nor a non-blocking loop: the matching scenarios stay on the worker. A message accepted before receiving starts belongs to the first session; the departed generation's queue is cleared when it finishes, otherwise a late answer or a lost early request distorts the tested contract.

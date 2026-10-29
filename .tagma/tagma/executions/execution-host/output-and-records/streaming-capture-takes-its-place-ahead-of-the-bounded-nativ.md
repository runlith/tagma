---
id: 01a12cbd-a3eb-713a-8131-8c823685773f
title: Streaming capture takes its place ahead of the bounded native read so pressure survives handover
ord: 5
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c92-9c5d-7a2f-b645-7a716a5ec421
sources:
  - kind: file
    ref: packages/execution-host/src/registry/assembly.ts
  - kind: file
    ref: packages/execution-host/src/registry/work.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.capture
  - kind: symbol
    ref: packages/execution-host/src/holder/Holder.ts
    symbol: Readable
---
Bytes read from an fd no longer belong to the kernel buffer, so awaiting place after read would leave suspend with a half-written chunk. Streaming capture takes place ahead of the bounded read; stopping the native source with stopCapture lifts the wait before bytes are borrowed, and a taken chunk is appended whole before the stop. Reopen guards the kept window until the new reader, so handing a live execution over keeps writing with no separate output remainder.

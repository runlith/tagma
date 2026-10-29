---
id: 01a15c50-c83c-7f29-b063-a4c62de1558f
title: The output stream is stdout and stderr in chunks in the order the host read them; its failure never touches source capture
ord: 9
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a15c3b-48c4-7846-8c30-4f17497a5e13
sources:
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.closeMirrors
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.mirrored
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.placed
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.settleOutput
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.tee
---
Two pipe descriptors share no kernel order, so the `output` order is the order capture got the chunks in: the queue place is taken in the same step as the read return, with no scheduler yield, and the chunk is appended to `output` whole when the queue reaches it. Reading answers synchronously when the pipe already holds bytes, so a yield between return and place would hand the order to another capture. Without the queue, parallel stdout and stderr captures would collide on the write, which allows one append at a time, and disk timing would decide the order.

A chunk reaches `output` before capture returns it. Suspend and seal, having closed source intake, first await chunks already queued in `output` and only then close it: read shutdown can end on budget while capture still works, and otherwise a chunk already sitting in stdout or stderr would vanish from `output` while the next logic continued it seamlessly.

`output` is not streaming: it holds no child and is evicted by its own retention window. Failing to append a chunk ends `output` with error — that wakes its readers and is journaled, so the next logic never continues it — while source capture goes on. For the same reason a record's availability and hold are judged on stdout and stderr alone: `output` keeps both streams in one window and loses the start earlier, while the agent reads stdout and stderr and must never see a break that is not in them.

`output` ends when both sources end — with error if either ended in error; reopen checks that at once if the sources ended before it.

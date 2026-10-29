---
id: 01a1662f-8eba-7ac3-b104-b31e35d3e139
title: Execution host native process reads do not hold its main loop
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1662f-c983-78ce-89c0-26fd0353b050",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1662f-6bcc-73be-ba35-6bb663aea3c0
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/processes.ts
  - kind: file
    ref: packages/execution-host/src/posix/ProcessAbi.ts
---
Native process-fact reading (`ProcessReader.facts`, the `posix/macos/processes.ts` adapter over `Abi.processFacts`) runs as synchronous FFI on the host's main loop. On 22.10 at 23:56:24.6Z it held the loop for 3.2 s (stall `b7d42d5d`, profile `ed54de63`), and the 2-second segment-write deadline (`bounded` in `RecordWriter`) on someone else's live execution fired on loop blockage, not on disk: the ACP agent's stdout stream closed with `error`, and the thread hung ([[63aea3c0]]).

To do: process-table reads whose cost grows with the process count (`facts`, `scan`/`table`) go off the main loop and answer asynchronously; the host loop never waits on the kernel. The model is the load-sampling worker (`posix/usageSampler.ts`). Leave the segment-write deadline alone: it keeps stop from hanging on a wedged disk.

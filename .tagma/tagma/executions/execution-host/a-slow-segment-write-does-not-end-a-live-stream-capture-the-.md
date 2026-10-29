---
id: 01a16642-c9b6-7f42-842c-a9b29a8bc9e2
title: "A slow segment write does not end a live stream capture: the carrier deadline stays only on stop"
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16643-0934-7ef4-b48b-a8a3c7479dac",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1662f-6bcc-73be-ba35-6bb663aea3c0
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRecord.ts
  - kind: file
    ref: packages/execution-host/src/RecordWriter.ts
  - kind: file
    ref: packages/execution-host/src/registry/work.ts
---
Every segment-write action (`append`, `sync`, `journal`, `open`) is capped by `ACT_MS = SHUTDOWN_PHASE_MS` (2 s, `bounded` in `RecordWriter`). A lapse on a live capture fences the stream, the `pipeline` in `registry/work.ts` ends the source with `error` and stops reading the pipe, while the process stays alive. Twice in the night of 22–23.10 the ACP agent's stdout died this way: at 23:56:27Z (with the host loop stalled 3.2 s) and at 00:49:50Z (no loop stall, on a disk packed with a live-database copy for `tagma:try`: 13.4 GB + 9.3 GB WAL). Both times the write was slow but answering.

The deadline exists so stop, suspend and seal never hang on a wedged disk. A live capture does not need it: while the carrier holds the write, capture waits and the child pushes against a full pipe — natural backpressure. Fix so a slow but answering write never ends the stream, and the deadline stays on the stop paths.

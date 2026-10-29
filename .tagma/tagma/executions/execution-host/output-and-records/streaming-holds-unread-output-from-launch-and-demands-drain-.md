---
id: 01a12cbd-a3c3-7baa-863e-6871d10ebec4
title: Streaming holds unread output from launch and demands drain for the child's progress
ord: 4
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12c92-9c5d-7a2f-b645-7a716a5ec421
sources:
  - kind: file
    ref: packages/executions/src/executionSpawner.ts
  - kind: file
    ref: packages/executions/src/protocol/launch.ts
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: SegmentRecord.follow
---
Streaming is declared at launch because a fast child can fill the record before the lazy Bytes subscription opens. A guarded stream backpressures in the same retained window: the caller drains the needed stdout/stderr concurrently with awaiting exit, or finishes the scope; one exitCode consumes no output. This pipe-contract term keeps bytes under bounded memory/disk, while an ordinary command with held history keeps evicting and honestly answers gap.

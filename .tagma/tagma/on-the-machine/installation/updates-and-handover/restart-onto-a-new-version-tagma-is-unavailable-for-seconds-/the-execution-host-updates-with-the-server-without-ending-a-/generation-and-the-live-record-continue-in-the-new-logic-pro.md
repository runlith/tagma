---
id: 01a1271e-2479-7971-9b0c-4eca5084ccfe
title: Generation and the live record continue in the new logic process
ord: 5
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
sources:
  - kind: file
    ref: packages/execution-host/src/ExecutionRecord.ts
  - kind: file
    ref: packages/execution-host/src/store/ExecutionStore.ts
  - kind: file
    ref: packages/executions/src/recordFormat.ts
---
In the line's worktree. `ExecutionStore` opens in the generation the holder keeps, not a new one (`store/ExecutionStore.ts:332-352`). The live record reopens without a seal: the record writer finishes the segment at close (boundary, checksum) and at resize (grid), the open segment is reread (`ExecutionRecord.ts`, `RecordWriter.ts`, `recordFormat.ts`). Proven by an integration test: a record started in one process and abandoned without a seal continues in the second; the reader sees a continuous stream; the seal at the end agrees on checksum and grid; generation refs stay current.

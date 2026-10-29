---
id: 01a1274e-49c5-7984-93dc-85577fe87be3
title: A run end waits for the last durable flush, and its failure is never swallowed
ord: 44
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126f4-468e-7368-9111-dba397533bc0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12712-5dd8-76d3-b854-53ad1fdb786a
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRunCycle.ts
  - kind: file
    ref: packages/agent/src/thread/transport/native/launches.ts
---
A run end must wait for the last durable flush, and its failure must not be swallowed.

`packages/agent/src/thread/run/ThreadRunCycle.ts:74` tries `projection.flush` twice on error, swallows the failure via `.ignore`, and calls `execution.settle`. Then `thread/transport/native/launches.ts:107` calls `recorder.stop().ignore` again. So the end outruns the final write: the last text, event, and tool-result buffer may live only in memory, and the third flush rescues it only after the run end; on one more refusal the buffer vanishes with the process. These lines are now being rewritten by the Effect-only core work.

Fix the order at the closing-loop owner: the last durable flush precedes settle, a flush error never becomes success and is never hidden. A public run operation must prove that a tail-write refusal is visible and the end does not outrun the tail, and that a successful final write lands in the journal once.

Once the completion order is fixed, the `applied_seq + 1` admission after the run end goes away together with the tail-rescue road.

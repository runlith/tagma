---
id: 01a17f5d-9e25-780b-9302-7f0783cb4628
title: "A thread fork learns on the first turn that it is a fork: one mark in `<workspace>`, the parent prefix untouched"
ord: 79
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17f55-8e93-7de8-8618-0a7d71ad6e56",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/rows/native.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/turns/message.ts
---
Root: fork birth (`branch_thread`, `spawn_agent` with `fork`/`forkFrom`) records nowhere whose copy the thread became, and no door except spawn (the `<agent-birth>` row) tells the agent. The operator's fork sees another's history as its own: it counts source children as its own and waits for their reports.

Decision: birth with a history copy records the origin (`native_thread.fork_of`: source and time), and `nativeTurnContext` places it as a world-state `fork` section into the same `<workspace>`. The world-state snapshot makes delivery single: after the turn the value is recorded and not repeated; a turn whose context message left history receives it again; after compression — together with the whole workspace. The fork's `<agent-birth>` row goes away: one delivery for all doors, native and ACP.

Acceptance: a first fork turn through `branch_thread` and through `spawn_agent` carries the source id once; the second turn does not; the fork's system and first-request messages match the parent's request plus its answer.

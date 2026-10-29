---
id: 01a12221-9359-7b9b-883a-67a0586c8f6e
title: "On SQLite the host slot not freed after an adopted post-restart child run: the 'a restarted process seats the spawned run it adopts' conformance falls"
ord: 180
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1220b-c29f-7eb2-9ec8-206533674dd9
sources:
  - kind: file
    ref: packages/agent/src/collaboration/collaborationResidency.ts
  - kind: file
    ref: packages/agent/src/thread/conformance/runLog/processes.ts
---
`apps/tagma/server/src/composition/testing/native-harness/runLog.processes.itest.ts` steadily falls on "a restarted process seats the spawned run it adopts, so the host slots count it until it ends". The fall reproduced on clean HEAD 13dce67095 in a temporary worktree, with no changes [[33674dd9]]. The InMemory adapter passes the same test.

What shows: the first four `expect`s pass, including the "1 spawned agents at once" refusal while the adopted run `first` goes. Then `first` turns `idle`, but `continue()` at `second` still refuses `This host runs 1 spawned agents at once and all 1 are working` (`collaborationResidency.ts:36`). So on SQLite the adopted post-restart run's slot not freed when that run ends.

Start with who calls `ThreadResidency.release` at an adopted run's end, and how the SQLite road differs from InMemory.

Done when the test passes on both adapters, with the fix at the slot freeing's owner.

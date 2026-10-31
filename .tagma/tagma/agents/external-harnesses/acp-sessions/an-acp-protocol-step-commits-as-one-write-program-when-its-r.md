---
id: 01a1908c-f305-7506-880c-d1c983d4ffc8
title: An ACP protocol step commits as one write program when its reads can be planned; it guards the session facet and lease owner, never the lease beat
ord: 16
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19024-7ec1-7479-b7dc-1386eb690904
  - kind: relates
    to: 01a10933-6ba7-7d05-bef5-c412e47bd3fc
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/steps.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/rows.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/store/sessions.ts
---
`ProtocolSteps.saved` cuts the journal with the planned form of the step first (`HarnessSessionStore.planned`) and takes the interactive `settle` when the step is written inside another unit (`within`), cannot be planned, or a guard refuses at commit. The planned step reads through the reader and guards every row its decision used: the thread's metadata and its transport adapter, the run it ends — its id, status and owner, or its absence — and the session facet with its lease owner. The facet guard leaves out `lease_beat`: heartbeats rewrite it between planning and commit, and guarding it turned a beating session's steps into conflicts. For the same reason the program's facet write keeps the standing beat while the lease is held and clears it only when the facet carries no lease, so a beat that landed meanwhile is never rolled back. A second transition of the same thread inside one step cannot be planned and takes the interactive path.

The step's program identity is the thread, the execution's incarnation, the stdout cursor offset and the step counter: the cursor the step saves is what recovery replays stdout from, so a step committed without an answer is recognized by the saved cursor rather than repeated.

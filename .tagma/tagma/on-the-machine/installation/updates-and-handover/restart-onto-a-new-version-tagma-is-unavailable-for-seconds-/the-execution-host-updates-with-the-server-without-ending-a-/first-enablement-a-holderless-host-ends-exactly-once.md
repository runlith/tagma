---
id: 01a1271e-2479-7971-9b0c-4ecea06a1a9e
title: "First enablement: a holderless host ends exactly once"
ord: 9
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
  - kind: waits-on
    to: 01a1271e-2479-7971-9b0c-4ecd2e350fc3
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/assembly.ts
  - kind: file
    ref: apps/tagma/server/src/executions/host/recovery.ts
---
In the line's worktree; lands in main together with the whole line ([[7c1b6811]]). A successor that finds after stage 3 a host whose bundle carries no holder ends it with that same bundle's recovery program (`endByRecovery`), raises a holder, tells the threads (`tellReplaced`), and writes to the restart record how many executions ended. Proven on one's own instance: an instance raised from a pre-line main build, with live terminals, restarted onto a line worktree build; the old executions ended exactly once with a recorded cause; the next restart with a host change keeps them.

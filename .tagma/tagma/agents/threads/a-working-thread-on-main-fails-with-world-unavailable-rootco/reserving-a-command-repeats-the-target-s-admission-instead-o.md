---
id: 01a16f0b-7e5d-7f5a-a52f-4931e81ecb5d
title: Reserving a command repeats the target's admission instead of refusing stale when the roots registry moved due to someone else's registration
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16eef-1363-771f-81df-465a5645c876",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16eec-b40f-7ab7-b313-475ddd4df78b
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/start.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/roots/uses.ts
---
`RootUses.reserve` inside a unit refuses `registry-changed` on any registry-revision shift after the footprint `recheck`, even when someone else's non-overlapping root was written. `Terminals.start` turns it into `TerminalRefused stale` (“the target moved”), and the thread's command fails for no reason. The check inside the unit is needed: overlap is judged by disk facts, which the unit lacks. So `start` does the recovery: outside the failed unit it re-admits the target (`coverage.admit` → `recheck`) and reserves again until the refusal is something other than `registry-changed`. A real move or overlap still refuses at `recheck`.

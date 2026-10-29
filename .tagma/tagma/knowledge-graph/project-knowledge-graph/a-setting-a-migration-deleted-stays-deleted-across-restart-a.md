---
id: 01a0e087-9002-7703-aaf8-c387be53c692
title: A setting a migration deleted stays deleted across restart, and a graph mirror moved half-way is never taken for a whole one (findings F002, F003)
ord: 215
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e087-c37c-7734-88da-fcaa7c4c0826",
    "status": "done"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: switchIfDue
  - kind: symbol
    ref: apps/tagma/server/src/installation/registry/restore.ts
    symbol: machineStoreLayer
---
From the architecture findings register (operator's scratch `spec-findings.md`).

- **F002.** `graph/projects/MachineRegistry.ts#machineStoreLayer:118` migrates before `#seedMachineRegistry:86`, so an old `registry.json` re-seeds settings a migration deleted (seen with `terminal.tabLayouts`, `commandPolicy.*`, [[369828ac]]). Fix at the owner: a migration's deletion survives boot; the registry export must not resurrect state the current schema removed.
- **F003.** `http/MirrorBuilder.ts#moveProject:545-579` runs sequential `db.run` without one transaction; `#mirrorHolds:535-541` accepts a mirror holding one matching block row. A crash mid-move leaves a partial graph served as whole. Fix: the move is atomic, and holding is decided by a completion marker, not by one row.

Done when: an integration test per finding fails on the old code and passes (restart with a stale registry keeps the deletion; an interrupted move is not served), claims over these files reconciled, commit names this task.
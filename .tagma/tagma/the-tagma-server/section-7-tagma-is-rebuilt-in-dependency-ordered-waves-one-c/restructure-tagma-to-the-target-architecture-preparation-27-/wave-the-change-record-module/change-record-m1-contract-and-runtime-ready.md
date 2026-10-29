---
id: 01a0e532-caea-7290-bfc2-a15d87daed90
title: "change-record M1: contract and runtime ready"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-42ad-7160-9b82-7a68c689e4cd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c833-7e69-8475-95bc0f489891
  - kind: waits-on
    to: 01a0e532-c85d-77a2-b8b1-9e87acb22feb
  - kind: waits-on
    to: 01a0e532-c891-73a5-8ec2-0df102919a95
  - kind: waits-on
    to: 01a0e532-c949-7ee7-90f4-b9199b5cb879
  - kind: waits-on
    to: 01a0e532-c9df-7dd6-b6d0-459b5b1efac5
---
§7.2.2 milestone `M1` of the `change-record` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]].

`platform/store/units.ts#readOnlyVerb` goes away when this milestone threads `MachineUnits` through `WorkspaceChangeLog`, `ThreadFiles` and `recordWrite`; its last users are `harness/WorkspaceChangeLog.ts` (13 module-level readers) and `harness/ThreadFiles.ts#authorshipAt`.

Accepted M1 divergence: the card names a durable prepared-change lease row, but [[d925fa0c]] K4 defines no row shape or restart need. `PreparedChanges` instead owns its temporary indexes in one directory and sweeps crash debris at boot, with the caller wired in this milestone; a durable row is deferred until a lease must survive restart. `ChangeRecord` is installation-scoped with explicit proven work-origin arguments, and `HeldTaskLabels` is bound per served graph and passed into the machine read.

Accepted assembly deferral: M1 binds the live contract faces through composition at their current paths; M2 writes `change-record/change-record.ts` with its layers and the manifest declaring tables, operations and events as those owners move. An inert M1 façade would supply neither layer nor manifest.

Before `held-resources` reaches gate, remove both unjudged `ThreadFiles.ts` bare `new Map()` arguments to `authorshipOf` (currently lines 678 and 742): retain the Map value type through the call's contextual typing or make the construction type explicit so the inspection can judge the lifetime, then prove both sites judged.
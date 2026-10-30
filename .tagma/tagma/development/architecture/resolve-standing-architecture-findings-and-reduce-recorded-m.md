---
id: 01a18d50-f344-7857-a8b2-e3225a3bed29
title: Resolve standing architecture findings and reduce recorded module coupling
ord: 27
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a18d3d-abce-7ac0-a4c4-0ae425400674
---
Remove the repeated declarations, unused production exports and direct model-call violations recorded by the architecture checks, at their real owners. Before working on an area, find the full cause and take over the debt of every file it covers. Reduce recorded module coupling without raising its ceilings; vendor identifiers remain owned by the adapter-packaging spec.
---
id: 01a0e532-c87d-718d-a110-bd7946642b39
title: "projects M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c870-7f94-9606-0aa60e45cf08
---
Final checks at 6d41d0ad40 over `projects/` (11 files): typecheck, `modules`, `names` and names-watch are clean, and `projects/` imports only `platform`. No debt entry names a projects task; `projects/` has no unit tests.

§7.2.2 milestone `M3` of the `projects` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].
---
id: 01a0e532-c870-7f94-9606-0aa60e45cf08
title: "projects M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e816-300f-732c-a1c2-61a63ba56cdd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-c85d-77a2-b8b1-9e87acb22feb
---
§7.2.2 milestone `M2` of the `projects` card ([[f7e0b9dd]]), with its vocabulary amendment [[8950b1dd]].

Divergences at finish:
- The serving-policy columns `strict_provenance`, `private` and `storage` still stand in `project` (`projects/store/table.ts`), written only by graph's code. D6's `project_policy` cut is graph's (§7.5 graph card, W3) and has not been built.
- The `projects` routes' K2 conversion belongs to the http wave (debt owner dd5ad950).
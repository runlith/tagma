---
id: 01a1471d-5818-7986-a05b-0115f07c0a79
title: "Implement explicit rule delivery: the delivery field, reach by sources, a migration step, set_law_delivery, and UI"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14711-d8db-722e-bd7d-1cb3cd14781c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1471d-2887-752b-b63b-e98f48a7aa11
---
Implement the spec [[48a7aa11]] in full: vocabulary and catalog, reach/law/instructions/touches/briefs, enforcement, the `rule-delivery` graph step, the `set_law_delivery` operation, UI, runlith doctrine and graph texts. Done when the touched packages' typecheck is clean, the spec's contract tests pass, a live check on its own `tagma:try` shows the prompt set and a code rule on touch, and the change is landed through submit_work.

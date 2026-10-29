---
id: 01a14c37-8e5d-7fff-aa5c-b7febe3e5af3
title: Problem report must take a consistent snapshot and must not promise filtering it does not have
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c05-9e90-75d0-ab7c-580f84a0bdd4
sources:
  - kind: file
    ref: apps/tagma/desktop/src/report.ts
---
`report.ts` takes the last segment and WAL by plain copying — not a consistent SQLite snapshot. Log and segment are not filtered, so the promised exclusion of texts and secrets is unproven. Take consistently; filter or drop the promise.

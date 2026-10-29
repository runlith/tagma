---
id: 01a0ca97-138f-7f6d-8296-9ec948bd3866
title: Write the claims of what a claim is measured against
ord: 200
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9d-3cfe-7730-852f-43a0afcd865f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/sources/readers
  - kind: file
    ref: apps/tagma/server/src/graph/measure/Sources.ts
---
Read `graph/measure/Sources.ts`, `graph/measure/sources/` and `graph/measure/imports/`.

Write the claims of [[f91a1b40]]: what each source kind is read from, what a symbol probe resolves and in which languages, what a directory source covers, what a date and a URL source are worth after the day they were taken, and what a reading that cannot be made answers — unmeasured is not verified, and the code is where that distinction is enforced.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
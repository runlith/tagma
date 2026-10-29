---
id: 01a0ca97-1386-7dc5-a64f-e836090b1af1
title: Write the claims of finding a block, and of the journal and the feed
ord: 199
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9d-3c77-743e-8c03-e4b1ee28e500",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/journal
  - kind: file
    ref: apps/tagma/server/src/graph/search/ranking.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/selection.ts
---
Read `graph/core/` — Ranking, Selection, stem, searchIndex, reads, wire, orcaProfile — and `graph/journal/` whole.

Write the claims of [[3e2134a2]] and [[211bdc2e]]: what a query matches and what it will not, how a term is stemmed and in which scripts, what a page's size is derived from and what the total beside it means, what a selection hides by default, and what the journal and the live feed each guarantee about order and arrival. A page figure carries the reason of the reader it serves — state that reason where the code holds it.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
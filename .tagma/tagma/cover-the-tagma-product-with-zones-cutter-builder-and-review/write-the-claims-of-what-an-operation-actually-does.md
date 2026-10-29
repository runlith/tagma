---
id: 01a0ca97-13e9-751a-91f1-4acb45d60e0a
title: Write the claims of what an operation actually does
ord: 215
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0cacd-2944-74f7-961d-c7a05e2922cf",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/operations
---
Read `apps/tagma/server/src/operations/` whole — the bound shape, the join table, and the seventeen family files behind it.

Write the claims of [[3dbd3b23]]: what a body owns as against its declaration, what a prepared value is for, how a refusal reaches a caller with its recovery contract, which operations refuse by structure rather than by rank, and what the operator-only subtraction protects. A reader arriving here wants to know where the law lives; say it once, precisely, and bind it to the code that enforces it.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
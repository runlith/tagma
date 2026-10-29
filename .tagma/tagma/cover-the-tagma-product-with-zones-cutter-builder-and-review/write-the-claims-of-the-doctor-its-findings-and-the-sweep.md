---
id: 01a0ca97-1396-7134-90c1-a6b48735ec76
title: Write the claims of the doctor, its findings and the sweep
ord: 201
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9d-3e30-7f13-a2ab-23a5a3fa7b64",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/measure/checks
  - kind: file
    ref: apps/tagma/server/src/graph/measure/Doctor.ts
  - kind: file
    ref: apps/tagma/server/src/graph/measure/sweepMark.ts
---
Read `graph/measure/Doctor.ts`, `graph/measure/checks/` and `graph/measure/SweepWatermark.ts`.

Write the claims of [[e49bba5a]]: what each check measures and what it does NOT prove, when a finding is filed and when it closes, what reconciliation reaches past the paths a caller aimed at, and what the watermark makes an incremental pass skip. Be exact about totality words here: a check that measures one condition over the blocks it selected is not a statement about the graph.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
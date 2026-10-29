---
id: 01a0c946-848d-790b-8d0c-92cb6c6c95ad
title: Write the claims of the request composition and the prompt-cache reading
ord: 142
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c948-6027-709e-916c-1cfbb74c0bd6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c944-8aa1-7e16-b225-ddc5d1caad35
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: packages/agent/src/thread/cache
  - kind: dir
    ref: packages/agent/src/thread/composition
---
Read `packages/agent/src/thread/composition/` and `packages/agent/src/thread/cache/` whole — nine files including three tests.

Fill [[ca2d112a]] and [[37580f83]]. Both read what compaction measured: [[8faf533f]] owns the budget arithmetic and the pruning record, so state here what the composition read and the warmth verdict are, not how a request is sized. The directory that consumes the warmth is [[3ef6226b]]. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, each area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
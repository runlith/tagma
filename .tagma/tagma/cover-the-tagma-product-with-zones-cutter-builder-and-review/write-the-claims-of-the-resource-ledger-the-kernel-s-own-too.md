---
id: 01a0c946-84b5-750d-bc40-2fe7273d15c1
title: Write the claims of the resource ledger, the kernel's own tools and the promise face
ord: 146
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
    ref: packages/agent/src/promise
  - kind: dir
    ref: packages/agent/src/resources
  - kind: dir
    ref: packages/agent/src/tools
---
Read `packages/agent/src/resources/`, `packages/agent/src/tools/` and `packages/agent/src/promise/` whole — ten files, about 730 tracked lines together.

Fill [[5501ab0b]], [[f802aa07]] and [[01fc2b5f]]. The promise face is a projection over the native doors, so a claim about it is a claim about the projection rule — what is lifted, what is left as it was, and what the border collapses — never a second statement of a verb [[c3e78736]] already owns. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, each area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
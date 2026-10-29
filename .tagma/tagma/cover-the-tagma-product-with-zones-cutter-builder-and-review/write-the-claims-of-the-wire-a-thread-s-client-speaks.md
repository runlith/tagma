---
id: 01a0c946-8459-7ae7-8870-98e01878a3a7
title: Write the claims of the wire a thread's client speaks
ord: 137
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
    ref: packages/agent/src/protocol
---
Read `packages/agent/src/protocol/` whole — nine files including three tests. The entry and page ceilings in `cap.ts` carry a derivation from a measured thread; check it against what the code applies.

Fill [[757d9a82]]. This directory stands on the harness floor and is read from below by the thread core and the snapshot owner — two of the three standing debts in [[72838d25]] are that divergence, and it is on record in `boundary.direction.ts`. `threadWireDeltas` is reachable only by relative import from three thread files. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
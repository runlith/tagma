---
id: 01a0c946-847a-70ad-873d-962c3e7546d7
title: Write the claims of the run machine
ord: 140
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
    ref: packages/agent/src/thread/run
---
Read `packages/agent/src/thread/run/` whole — thirty-six source files and twenty-four tests, about 9,600 tracked lines. It is the largest area of this module; read it in the order of its seven children rather than alphabetically.

Fill [[a43f39ba]], [[f609c71a]], [[4321720c]], [[408c5fc6]], [[d0b58b13]], [[9da5905b]] and [[e801d5b9]], and correct [[c4510285]] where the code differs from what it states. `ThreadInteraction.ts` and `ThreadRunLease.ts` already carry a claim of [[e0ee2866]] about stopping a parked approval — read it and relate rather than contradict. Every cadence in here is a host input; a claim naming a number must name whose number it is. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, each area's body and sources match what the files hold, an exception that breaks a container is its own claim referenced from the qualified container, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
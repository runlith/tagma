---
id: 01a0c946-84a2-729e-8d3c-52c8edb91013
title: Write the claims of the collaboration plane
ord: 144
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
    ref: packages/agent/src/collaboration
---
Read `packages/agent/src/collaboration/` whole — twenty-five files, eight of them tests, about 3,500 tracked lines: the spawn tree, the envelope ledger, the directory, the rights vector, the depth ceiling, the budget, the residency and workflow-member bindings, the tool catalog and the two prompt voices.

Fill [[3ef6226b]]. The plane is assembled per run and the run machine never sees it; `ThreadSpawnTree.ts` reaches into a large part of [[c4510285]], so state what the plane decides, not what the run machine does. `branchBirth`, `THREAD_BRANCH_MARKUP`, `spawnTypeSubject`, `ThreadSpawnRequest` and the envelope id minters are reachable only by relative import and not through the barrel: check whether that is a boundary worth a claim. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
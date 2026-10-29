---
id: 01a0c946-8485-7381-88ae-69b86a47bd52
title: Write the claims of which agent a thread is
ord: 141
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
    ref: packages/agent/src/thread/agents
---
Read `packages/agent/src/thread/agents/` whole — thirteen files including five tests: the profile a thread is born with, the registry, the type catalog a spawn chooses from, the admitted tool sources, the effective permissions and the frozen prompt.

Fill [[6e94ed66]]. The permission vocabulary it composes over is [[4c82c2b1]] and the plane that reads its type catalog is [[3ef6226b]]: relate rather than duplicate. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
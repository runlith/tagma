---
id: 01a0c946-846f-77f8-b4c9-052fc5da107b
title: Write the claims of the ports a product fills
ord: 139
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
    ref: packages/agent/src/thread/storage
  - kind: file
    ref: packages/agent/src/thread/ThreadPorts.ts
---
Read `packages/agent/src/thread/ThreadPorts.ts`, `packages/agent/src/thread/ThreadStepObserver.ts` and `packages/agent/src/thread/storage/` whole — fourteen storage files, three of them in-memory fills.

Fill [[c765e6ba]]. Eighteen of the kernel's fifty-one services are declared in `ThreadPorts.ts`; [[195fe16c]] already states the naming convention over all of them, so state here what each port obliges its filler to, not that they share a prefix. The suites that prove a filling are [[c719285e]]. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
---
id: 01a0c946-84ab-7593-be6f-c49207dd0db4
title: Write the claims of the workflow plane
ord: 145
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
    ref: packages/agent/src/workflow
---
Read `packages/agent/src/workflow/` whole except `conformance.ts`, which belongs to [[c719285e]] — seventeen files including five tests: the definition schemas, the compiler, the plan, the engine, the library, the run vocabulary with its lease and amendment handling, the in-memory store, the config and the voice.

Fill [[99653ee8]]. `WorkflowVoice.ts` is not re-exported from the barrel: check whether that is a boundary worth a claim. Members are started through the collaboration plane's binding ([[3ef6226b]]) — relate rather than duplicate. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, the area's body and sources match what the files hold, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
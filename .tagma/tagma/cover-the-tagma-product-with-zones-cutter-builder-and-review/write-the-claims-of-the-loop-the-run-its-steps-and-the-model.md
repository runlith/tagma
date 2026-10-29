---
id: 01a0c946-8411-7521-a74b-4691fd7f41d8
title: "Write the claims of the loop: the run, its steps and the model port"
ord: 133
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
    ref: packages/agent/src/agent/turn
  - kind: file
    ref: packages/agent/src/agent/AgentRunner.ts
  - kind: file
    ref: packages/agent/src/agent/modelPort.ts
---
Read `packages/agent/src/agent/turn/` whole, and in `packages/agent/src/agent/`: `Agent.ts`, `AgentRunner.ts`, `AgentScope.ts`, `AgentContext.ts`, `AgentRecovery.ts`, `AgentReplayLog.ts`, `AbortWatch.ts`, `spans.ts`, `AgentStep.ts`, `AgentTurn.ts`, `AgentRunState.ts`, `modelPort.ts`, `ModelCalls.ts`, `ModelRequests.ts`, `modelDialect.ts`, with their tests and the two benches.

Fill [[89f2bd8e]], [[7b858c68]] and [[b160c0e2]], and correct [[d45ec974]] where the code differs from what it states. The module above is [[d1caad35]]; its boundary claims are already written and verified — do not restate them. Reference zones cut and accepted: [[249ce587]] and [[6c81c6f3]] — match their precision, never their size.

Done when every claim is written from the code and verified against its own sources, each area's body and sources match what the files hold, an exception that breaks a container is its own claim referenced from the qualified container, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
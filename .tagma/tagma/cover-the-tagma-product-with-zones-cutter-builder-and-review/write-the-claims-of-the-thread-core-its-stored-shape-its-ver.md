---
id: 01a0c946-8464-79f7-ab92-1d904400d6ca
title: "Write the claims of the thread core: its stored shape, its verbs, its evidence and its border"
ord: 138
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
  - kind: file
    ref: packages/agent/src/thread/AgentHarness.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadAggregate.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadQuery.ts
---
Read the files directly in `packages/agent/src/thread/` — not its subdirectories: `rows.ts`, `state.ts`, `persisted.ts`, `identity.ts`, `attachmentStorage.ts`, `toolOutputs.ts`, `ThreadAggregate.ts`, `ThreadEventDoor.ts`, `events.ts`, `inboxItems.ts`, `HistoryFold.ts`, `ThreadTail.ts`, `ThreadAsides.ts`, `ThreadQuery.ts`, `ThreadIntrospection.ts`, `ThreadBranch.ts`, `ThreadBorder.ts`, `ThreadFailure.ts`, `AgentHarness.ts`, `index.ts`, with their tests.

Fill [[53d0aee9]], [[c32ee699]], [[4b32b3eb]], [[da7da0be]], [[924ce8b4]] and [[d9690fa9]], and correct [[c3e78736]] where the code differs from what it states. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, each area's body and sources match what the files hold, an exception that breaks a container is its own claim referenced from the qualified container, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
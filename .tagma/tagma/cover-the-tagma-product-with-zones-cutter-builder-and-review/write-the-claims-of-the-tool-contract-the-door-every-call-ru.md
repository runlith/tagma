---
id: 01a0c946-8437-7c2b-8b4d-1fcda19895f2
title: Write the claims of the tool contract, the door every call runs through, and what the model is told
ord: 134
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
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: file
    ref: packages/agent/src/agent/tool.ts
  - kind: file
    ref: packages/agent/src/agent/WorldState.ts
---
Read in `packages/agent/src/agent/`: `tool.ts`, `ToolCatalog.ts`, `ToolPage.ts`, `ToolOutput.ts`, `ToolOutputSpool.ts`, `AgentToolDoor.ts`, `AgentCalls.ts`, `AgentRuntimePolicy.ts`, `callProgress.ts`, `callSignal.ts`, `AgentActivity.ts`, `AgentCallMeasurement.ts`, `WorldState.ts`, `AgentSkill.ts`, `agentSkillRequests.ts`, `skillReferences.ts`, `AgentDeferredTools.ts`, `AgentGuidanceJournal.ts`, `contracts.ts`, `AgentEvent.ts`, `AgentFailure.ts`, `AgentSignal.ts`, `AgentAside.ts`, `AgentApproval.ts`, `AgentMessageFold.ts`, with their tests.

Fill [[b645577c]], [[0361efbb]], [[6f0a77c7]] and [[8cb71755]]. `AgentCalls.ts` and `callProgress.ts` already carry claims of [[e0ee2866]], a product-level area spanning this kernel and the Tagma server: read them first and relate to them rather than restating or contradicting them. The module above is [[d1caad35]]. Reference zones: [[249ce587]] and [[6c81c6f3]].

Done when every claim is written from the code and verified against its own sources, each area's body and sources match what the files hold, an exception that breaks a container is its own claim referenced from the qualified container, `run_doctor` over these paths stands clean, and a review leaves no false, overbroad or unsupported sentence unresolved.
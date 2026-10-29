---
id: 01a13f0c-3b38-7785-8c16-49ba6712483e
title: Migrate the AgentCalls, door invocation lifetime, world state and thread door tests to Effect
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentCalls.test.ts
  - kind: file
    ref: packages/agent/src/agent/door/ToolExecutionCalls.test.ts
  - kind: file
    ref: packages/agent/src/agent/WorldState.test.ts
  - kind: file
    ref: packages/agent/src/thread/agents/ThreadAgentDoors.test.ts
  - kind: file
    ref: packages/agent/src/thread/agents/threadCaller.test.ts
---
Migrate AgentCalls, ToolExecutionCalls, WorldState, threadCaller and ThreadAgentDoors to @runlith/effect-test. Keep stop/hand-off/admission/debt/cleanup/race and read-back lifetime, snapshot and typed inventory of world state, caller identity and the mode registry. The test owns the scope; Effect waits use events, the low-level AgentCalls real timers and GC are verified through it.live with no production change. Remove runners and unsafe scopes; complete doubles instead of partial service casts. Proof is the group's tests, typecheck, check_law and one review round.

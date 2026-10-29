---
id: 01a13ddb-4063-7aea-afb7-4d86016ef5e2
title: Migrate the skill loading, requests, write ordering, tool output and aside lifetime group to Effect tests
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentSkill.test.ts
  - kind: file
    ref: packages/agent/src/agent/agentSkillRequests.test.ts
  - kind: file
    ref: packages/agent/src/agent/AgentStepWrites.test.ts
  - kind: file
    ref: packages/agent/src/agent/ToolOutput.test.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadAsides.test.ts
---
Migrate the five test files to scoped Effect with no lost contracts: payload freshness and reader provenance, tool gating, the dependent-writes queue, output bounds and aside cancellation. Shared fixtures stay contextual, events are awaited with a stream/Deferred. Shrink the excessive output fixture volume to a minimal bound overflow and remove copy-pinning of the truncation marker word. Proof is the group's tests, typecheck, check_law and review.

---
id: 01a13f22-3a6b-76de-8fc7-41da6e50b6fd
title: Migrate the definitions, registry and thread agent context tests to Effect
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/agents/admittedToolSources.test.ts
  - kind: file
    ref: packages/agent/src/thread/agents/AgentDefinitions.test.ts
  - kind: file
    ref: packages/agent/src/thread/agents/AgentRegistry.test.ts
  - kind: file
    ref: packages/agent/src/thread/agents/grantedCatalog.test.ts
  - kind: file
    ref: packages/agent/src/thread/agents/ThreadAgent.test.ts
---
Migrate AgentDefinitions, AgentRegistry, ThreadAgent, admittedToolSources and grantedCatalog to @runlith/effect-test. Keep dynamic capability adding and revoking, registry collisions and disposal, the grants catalog limit on native/hosted/restored roads, publication and the context boundary refusal. Remove manual runners, partial casts and useless checks; effectful fixtures give Effect/Layer, resources and runner disposal belong to the test. The production AgentRunner and its separate migration task are out of scope. Proof is the five files' tests, package typecheck, check_law and one Sol+Muse review round with sizes and an account of removals.

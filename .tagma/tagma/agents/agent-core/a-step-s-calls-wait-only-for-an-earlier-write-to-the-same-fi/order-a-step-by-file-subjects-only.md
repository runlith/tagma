---
id: 01a0f9a9-a2fb-7f1b-a5d6-c2a209788edd
title: Order a step by file subjects only
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f9aa-8a64-7e78-b306-f3fc2d188f9c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0f9a9-a2e1-76d0-bc65-c4606b54ddf1
---
Build [[6b54ddf1]]. Start at `pathAccesses` in `packages/agent/src/agent/turn/tools.ts` and `rememberWrite` in `AgentToolDoor.ts`, then every place a filesystem-path subject is built (`packages/agent-tools`, server operations naming checkout paths). Done when the spec's acceptance holds and the queue claims (0196b233, 86bf47f7, 988335aa, 4b8ff5eb) say what the code does.
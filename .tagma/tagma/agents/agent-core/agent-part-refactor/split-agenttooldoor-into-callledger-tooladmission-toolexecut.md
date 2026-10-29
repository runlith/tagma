---
id: 01a11901-5360-733e-9ca2-91256496bdc5
title: Split AgentToolDoor into CallLedger, ToolAdmission, ToolExecution, OutputProjection
ord: 23
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd49bc6e931
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911fc86fbefa
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-912018df4b16
---
Implements [[9bc6e931]]. Start with `packages/agent/src/agent/AgentToolDoor.ts`.

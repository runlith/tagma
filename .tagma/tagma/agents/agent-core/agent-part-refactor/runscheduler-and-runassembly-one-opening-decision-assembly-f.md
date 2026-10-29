---
id: 01a11901-5360-733e-9ca2-9124eb2a5ae8
title: "RunScheduler and RunAssembly: one opening decision, assembly from one read"
ord: 22
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118eb-3e7e-7085-8f2e-2cd0a34152ed
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-911fc86fbefa
  - kind: waits-on
    to: 01a11901-5360-733e-9ca2-9121a7add807
---
Implements [[a34152ed]]. Start with `ThreadTurnRunner.ts`, `ThreadAggregate.ts`, `ThreadRunStarter.ts`.

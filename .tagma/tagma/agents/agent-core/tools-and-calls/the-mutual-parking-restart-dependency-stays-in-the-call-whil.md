---
id: 01a15277-bce9-70b3-972c-664479f5c7e5
title: The mutual parking-restart dependency stays in the call, while Layers assemble ready question ports
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09db3db3a70d
sources:
  - kind: file
    ref: packages/agent/src/thread/AgentHarness.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
  - kind: file
    ref: packages/agent/src/thread/run/Questions.ts
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/intake.ts
  - kind: file
    ref: packages/agent/src/thread/transport/native/launches.ts
---
The mutual parking-restart dependency stays in the call, while Layers assemble ready question ports.

A parked question and resuming after the answer need each other while running, so capturing both ports when creating the owners would have closed the assembly graph. Native launch and scheduler.resume require QuestionIntake in their call environment; Questions closes that dependency with its own ready Intake for answer, deadline, and serving. That lets the restart's owner assemble before Questions, and the native transport after it: composition sets the order while keeping a statically checkable dependency in the call.

---
id: 01a151df-e920-73d7-9b09-09db3db3a70d
title: "The core assembles without later-filled ports: question parking and restart after an answer"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-f13f-7600-9274-8b6e02ae3a9c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/intake.ts
---
`packages/agent/src/thread/run/scheduler/intake.ts` declares `QuestionIntake` and `QuestionRelaunch` as cells filled later by `thread/run/Questions.ts:177` and `thread/transport/native/NativeRuns.ts:22`; before filling, a call dies with `Effect.die`. That is the same late-filled service the core assembly moved away from: the order rests on convention, not on a Layer graph. Question waiting, dedup, and the agent-recorder link inside one run (`assembly/RunAssembly.ts`) are legitimate mechanics and out of scope.

To do: the cycle breaks at the owners — the lower one declares a port, the upper one supplies it as a Layer, composition binds; `fill` and cells are deleted.

Proof: no fill and no late-filled cells at QuestionIntake and QuestionRelaunch; the test host assembles the core from InMemory ports in the same Layer order; question, parking, and approval suites pass with unchanged assertions. RunSweep and the global no-fill criterion belong to a separate task [[0c0ee6d9]].

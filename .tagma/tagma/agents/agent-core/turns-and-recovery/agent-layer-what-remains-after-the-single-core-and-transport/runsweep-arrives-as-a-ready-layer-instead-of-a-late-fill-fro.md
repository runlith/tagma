---
id: 01a1526a-690d-77f1-9457-5a010c0ee6d9
title: RunSweep arrives as a ready Layer instead of a late fill from EndingWalk
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a151df-e920-73d7-9b09-09db3db3a70d
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: file
    ref: packages/agent/src/thread/AgentHarness.ts
  - kind: symbol
    ref: packages/agent/src/thread/ThreadPorts.ts
    symbol: RunSweep
---
`thread/run/RunSweep.ts` holds a global mutable `fill` cell; before the sweep connects it silently returns void. The production connection lives outside the agent package: `threads/ending.ts:209` calls `harness.sweeping.fill`, EngineHandles and AgentHarness.runs.sweep expose the cell outward. That is another construction cycle between the core and the server EndingWalk, distinct from question parking and native relaunch. Break it at the owners: a lower ready host/provider port and explicit composition, with no silent default and no setter rename. Prove public Stop on a tracked/untracked run and queued-input restore on write refusal; question ports need no change.

This task's criterion is no `fill` on `RunSweep` and `EngineHandles.sweeping`. The second late-filled port, `RunGuidance.fill`, is a separate task; the global "no `fill(` in packages/agent/src" is declared after both.

## Outcome

Commit `32e232a829`. `RunSweep` is a host port in `ThreadPorts.ts`: a host without it declares `null`. The server supplies it to the engine from `makeRunSweep` in `threads/ending.ts`. `fill`, `EngineHandles.sweeping` and `HarnessRuns.sweep` are removed. The RunExecution, ThreadRunCycle, ThreadRunOwners, ThreadAggregate, ending.test, commandAdmission and placement suites passed without changed assertions; review with no findings.

Stop through a real server is proven by commit `ed4d243e09`. `threadArchive.stest.ts` failed in all 17 tests on `no-model-connected` at flow birth: after `b15bfdead3` birth needs a chosen model. The fixture picks it through `chosenModel`, as neighboring suites do; assertions unchanged. Now 17 of 17 pass, including stopping the run in the subtree on archive. At commit time the server typecheck reddened on another's error in `threads/operations/notes.ts`.

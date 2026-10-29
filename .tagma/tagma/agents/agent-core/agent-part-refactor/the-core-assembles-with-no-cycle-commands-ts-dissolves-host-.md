---
id: 01a118eb-3e7e-7085-8f2e-2cd27337d0bb
title: "The core assembles with no cycle: Commands.ts dissolves, host config splits into ports by subject"
ord: 8
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/AgentHarness.ts
  - kind: file
    ref: packages/agent/src/thread/kernelPorts.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadPorts.ts
---
Goal: the core assembles as an acyclic Layer graph of named host ports. A second host (later the plugin host, today the test host) assembles it without copying Tagma closures. The facade is grouped by subjects, not by caller convenience.

## Now

- The runtime graph is cyclic. `Commands.ts` stands above collaboration and fills its ports with the run machine's services, while the machine needs services built above it. The cycle closes with late `Deferred` services (`AgentHarness.ts:456-465`, `Commands.ts:145,254-259` `late()`). Tagma repeats the trick one level up: `KernelOpening` (`native-harness/kernel.ts:212-222`). An ordinary caller never observes an unfilled `Deferred`, but the dependency is hidden and the assembly order rests on convention.
- `ThreadToolSources`, which provides `featureLayers`, leaks into the `ThreadTurnRunner` `R` channel and is hand-provided.
- `featureLayers` (`AgentHarness.ts:289-318`) is a closed list of features providing tool sources.
- `ThreadHostConfig` (`ThreadPorts.ts:356-391`) is one tag for host rhythms, owner id, four hosted ports, transcript projection, input recovery, three lifecycle hooks, and model switches. That contradicts [[2fcf2221]].
- `AgentHarnessConfig` is about 35 fields (`AgentHarness.ts:147-196`). Four `fillers` decorate native ports with host closures, and `onSettled`, `toState`, and `onModelMoved` encode Tagma policy as anonymous functions.
- `Commands.ts` is named after nothing and holds nine duties: births, catalog listing, lineage, run start/deliver/continue/stop, compaction requests, model switching, agent-kind offerings, end pipeline. It imports collaboration source ids to decide native capabilities.
- Facade: `AgentHarness` (32 methods) and `ThreadHandle` (23); `hosting()`, `parkedRuns()`, and `onDriving()` go through `Effect.runSync`. The promise twin `promise/index.ts` exists only for Tagma test fixtures.

## What gets built

- **`Commands.ts` is deleted.** Native fillers move to their owners:
  - births go to the native tree adapter in `collaboration/`, which creates that cut (further splitting is [[87916291]]);
  - admission policy lives in `RunScheduler` and its lower contract ([[a34152ed]]). The collaboration-port filler `ThreadRuns` (`collaboration/runs.ts:51-87`) stays above the run machine and is created by that cut next to the native tree adapter. It translates scheduler outcomes into the collaboration contract and holds no second admission policy;
  - compaction requests go to `thread/compaction`;
  - model switching goes to one thread-settings writer;
  - agent kinds go to the agent registry;
  - the end pipeline goes to settlement.
- **The cycle breaks at owners, not with timeouts.** `deleteRow` is reached through `ThreadDeletion` below the facade. Assembly is ordered Layers plus one edge resolved at call time: harness → the `ThreadAgents` registry. That edge exists because the recursion is real: an agent's tools fetch operations, and operations fetch the harness, so a tool call can open a run.
  - `ThreadAgents` is a registry in the shared registry-contract shape [[bb429da3]], for [[629ac667]] to extend rather than replace. The registry store sits low in the order and starts empty.
  - The agent half of the Tagma `NativeKernel` (`composeAgent`, `threadContext`, asides, call hooks) becomes a separate Layer above `ThreadExecution`, `ThreadTitles`, and `OwedCalls`; at assembly it registers agents in the registry. `KernelOpening` is deleted.
  - `AgentHarness` reads the registry on every call. An agent missing from the registry is a typed refusal, not a nullable value and not a wait.
  - The composition order pins this: all registration finishes before any door starts serving, so a half-filled registry is never read while serving. There is no mutable cell outside the registry.
- **`ThreadHostConfig`** splits into named ports, one tag per subject; rhythms become four ports (lease, reaper, settlement, stream). Birth, readiness, and model-move hooks stay nullable host ports (`ThreadBirthRecords`, `ThreadReadiness`, `ThreadModelMoves`), not subscriptions: a birth writes in the birth transaction, and readiness must complete before a run opens, with its failure refusing the act. A post-event subscription is not in the transaction and cannot refuse, so it is wrong here.
- **`AgentHarnessConfig`** becomes a set of port Layers plus an optionals argument last ([[c2f04d22]]): `AgentHarness.make(ports, live, { toState?, settled?, fillers? }): Effect<AgentHarness>` builds the core in its own scope, so async port Layers assemble. The host assembles `ports` from subject constructors in `thread/kernelPorts.ts` (`threadStorageLayer`, `threadFeaturesLayer`, `threadCompactorLayer`, `threadAgentsLayer`) plus `threadHostLayer`; optional ports (`EndingStages`, `RunAdmission`, `ThreadJournalLane`, `ThreadAgents`, `ThreadToolRegistry`, `ThreadTypes`, declared features) have defaults that a host port overrides. Tagma policy is port fillers, not closures in configuration.
- **`featureLayers`** is replaced by registrations in the source registry already built by [[8451c5c9]]: each registration and each collaboration-layer choice reads its own declared feature port (`DeclaredCollaboration`, `DeclaredResources`), and the core takes no feature configuration as a separate argument.
- **The facade** regroups by subjects: `threads`, `runs` (recovery, hosted ledger, hosting, drive hook, end redelivery, parked runs), `inputs`, `reads`, `collaboration`, `workflows`. `runSync` leaves the facade.
- **`promise/` is deleted**; fixtures move to Effect under the Effect-native port contract [[69dafa08]].
- **The card order on [[d1caad35]]** is updated via `set_module` by the same change.

## Acceptance criteria

- Core and Tagma kernel assembly with no `late()` and no `KernelOpening`. No service takes another through a late-filled `Deferred`; the only call-time edge is the harness's read of the `ThreadAgents` registry, and calling an unregistered agent is a typed refusal.
- The card's import check: `thread/run` does not import `collaboration/`, and `Commands.ts` does not exist. The debt record disappears.
- The test host assembles the core from `InMemory` ports with no Tagma closure. Those are the [[523c3230]] runners.
- Every `ThreadPorts` service tag holds one subject: review against [[2fcf2221]].
- Behavioral suites pass with no assertion changes.

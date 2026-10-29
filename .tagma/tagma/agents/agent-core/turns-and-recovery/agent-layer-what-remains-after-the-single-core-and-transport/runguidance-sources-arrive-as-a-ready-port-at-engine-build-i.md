---
id: 01a1527f-3515-7a77-a22e-b43bc6d116f7
title: RunGuidance sources arrive as a ready port at engine build instead of a late fill from the foreign-CLI build
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1526a-690d-77f1-9457-5a010c0ee6d9
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/assembly.ts
  - kind: file
    ref: packages/agent/src/thread/run/RunGuidance.ts
---
`RunGuidance` (`packages/agent/src/thread/run/RunGuidance.ts`) holds a mutable sources cell and a `fill(sources)` method. While the cell is empty, `prompt` silently returns an empty orientation and `notes` an empty tail. Production fills it from outside the core: `apps/tagma/server/src/external-harnesses/assembly.ts` calls `harness.runs.guidance().fill(...)` after the engine is already built. The sources there are project orientation, law delivery and the operator-notes tail for terminal flows. `HarnessRuns.guidance()` exposes the cell outward. That is the same construction cycle `RunSweep` had in [[0c0ee6d9]].

Do: the cycle breaks at the owners. The core declares a guidance-sources port, the server supplies it ready at engine build, composition binds. `fill` and the cell go away. If a source is by nature needed only in the call (like parking the question in [[3db3a70d]]), it goes into the call environment, not into a cell.

Proof: no `fill(` in production code under `packages/agent/src`.

## Outcome

Commit `a1f02b935d`. The second path from "Do" was taken: `prompt` and `notes` are called only by foreign-CLI transports (ACP `ProtocolPrompts`, terminal hooks), and the sources belong to them. So `GuidanceSources` is an argument of the `LaunchGuidance.prompt/notes` call (types in `transport/contract.ts`), and the core holds only the projection of what was delivered along the flow. The cell, `fill` and the silent empty orientation are removed. Sources are built by `makeGuidanceSources` (`external-harnesses/guidanceSources.ts`), the session place by `makeSessionPlace` (`sessions/place.ts`). The build passes sources to the ACP driver and hooks. The system test `hookPlace` builds the same sources through the testing entry. Suites pass without changed assertions: hookPlace 3, protocolMethods 19, terminalGuidance 2, hookReport 26, protocolWords 8, protocolRuns 8, RunGuidance.test 5. Review found one: `HarnessGuidance.sources` was a seam for the test only; the member is removed.

Not proven: `protocolActs.stest.ts` fails 1 of 5 — a born flow has `reasoning: null` instead of `'medium'`. The assert stands before the first turn; this work does not touch birth; the cause is not established. The test host is built from InMemory ports. Guidance and terminal-flow suites pass without changed assertions.

---
id: 01a18e32-4bbd-7a2a-9161-3ca007a3650c
title: protocolRoad tests lose the execution host when the twelve rig files run in one process
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a18d5f-315e-7cf6-89b8-16def116d3cd
---
With all twelve rig files (`composition/testing/threads/{protocolRoad,terminalHistory,terminalConformance,protocolHandover,harnessUntitled,hostedDefaultMove,hostedFork,hostedMove,hostedReveals,claudeConformance,claudeContinue,claudeCut}.itest.ts`) in one `testbed bun test --no-isolate` process, some `protocolRoad` tests fail nondeterministically: every `scenario(floor([]))` test hangs 180 s on `WireUnavailable` (`packages/executions/src/WireSession.ts:253`, from `testing.protocolFloor`, `protocolRig.ts:321`). Each file passes alone and in smaller groups.

It predates 5a473fdd02: at f38b881c, seed 1 failed 4 protocolRoad tests (live session copy, permission across restart, relaunch after move, turn across a restart onto another build); seeds 2 and 3 passed 54/54.

Lead, not proven: protocolRoad's worker ran last, and bun printed `killed 7 dangling processes` when the other workers finished, about 22 s after the first failing test started; later failures each followed `killed 1–2 dangling processes`. The execution host behind the rig's endpoint is probably killed as another file's dangling process under `--no-isolate`. Which process and which file has not been identified.

A worktree has no `packages/execution-host/native/target/release/libexecution_platform.dylib`, and the rig suites `skipIf` it absent, so a fresh worktree run is a false green unless the library is copied in.
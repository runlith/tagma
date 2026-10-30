---
id: 01a18e32-4bbd-7a2a-9161-3ca007a3650c
title: protocolRoad tests lose the execution host when the twelve rig files run in one process
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18d5f-d1a2-7ec4-8e80-38ffb97302f1",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18d5f-315e-7cf6-89b8-16def116d3cd
---
With all twelve rig files (`composition/testing/threads/{protocolRoad,terminalHistory,terminalConformance,protocolHandover,harnessUntitled,hostedDefaultMove,hostedFork,hostedMove,hostedReveals,claudeConformance,claudeContinue,claudeCut}.itest.ts`) in one `testbed bun test --no-isolate` process, some `protocolRoad` tests fail nondeterministically: every `scenario(floor([]))` test hangs 180 s on `WireUnavailable` (`packages/executions/src/WireSession.ts:253`, from `testing.protocolFloor`, `protocolRig.ts:321`). The original runs passed alone and in smaller groups. A later standalone run of `protocolRoad.itest.ts` with `--randomize --seed=1` also failed: `Enter in the state running` reached the 180 s guard at 180159.63 ms with `WireUnavailable`, traced through `packages/executions/src/WireSession.ts:253` → `composition/testing/threads/protocolWordRig.ts:23`; teardown logged `WireLost` and testbed killed two dangling processes. The remaining full-file command was stopped with exit 130 after that verdict. Its complete output is `/Users/teunlao/.tagma-dev/executions/01a083b0-37bd-7a58-9ba1-be2b7b69a2e8/records/64383336303337382d363730662d343434632d386239342d663232336530613634633338/output.log`; testbed report `/tmp/runlith-test/reports/run.62098.1793388565461.jsonl`. This establishes that the execution-host loss is not limited to twelve files sharing a process.

It predates 5a473fdd02: at f38b881c, seed 1 failed 4 protocolRoad tests (live session copy, permission across restart, relaunch after move, turn across a restart onto another build); seeds 2 and 3 passed 54/54.

Lead, not proven: protocolRoad's worker ran last, and bun printed `killed 7 dangling processes` when the other workers finished, about 22 s after the first failing test started; later failures each followed `killed 1–2 dangling processes`. The execution host behind the rig's endpoint is probably killed as another file's dangling process under `--no-isolate`. Which process and which file has not been identified.

A worktree has no `packages/execution-host/native/target/release/libexecution_platform.dylib`, and the rig suites `skipIf` it absent, so a fresh worktree run is a false green unless the library is copied in.
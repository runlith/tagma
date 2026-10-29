---
id: 01a16dc7-39c2-7d47-b275-2c2daf42588f
title: A shared world's background process gets a guard refusal when a worker mixes unit and resource files
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18898-7ba2-7e22-adbf-2fb5249e520f",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a16c99-f00e-7823-9cd1-9ae91c6e2051
---
Found by the server-reds-b fixer while diagnosing in the [[1c6e2051]] analysis. Under `--no-isolate` a resource file with a shared world runs in one worker, followed by a unit file. `packages/testbed/src/core/bed.ts:50–61` judges by `kindOf(options.file())` with no world provenance; `packages/testbed/src/bun.ts:68–75` passes the current `Bun.main` with no exemption. The world's background spawn gets a `LayerViolation` when the next unit file holds the guards. Smallest observed, not yet minimized, command from `apps/tagma/server`: `../../../node_modules/.bin/testbed bun test --parallel=1 --no-isolate --randomize --seed=2 ./src/composition/testing/threads/terminalCore.itest.ts ./src/composition/testing/threads/operatorMessage.itest.ts ../../../packages/agent/src/thread/run/RunExecution.test.ts ../../../packages/agent/src/thread/run/ThreadAggregate.test.ts`. In `~/.tagma-dev/scratch/01a16d94-df9e-7630-a5a1-0f75fcc5aaa8/opening-work-final-seed2.log:355–385` the background tree-refresh spawn is attributed to `ThreadAggregate.test.ts`, though 64 tests passed; seed 1 attributes it to `RunExecution.test.ts` (`opening-work-final-seed1.log:362–392` in the same directory). A separate defect: it does not explain the seed-3-only timeout, where unit files ran earlier.

Done when a process spawned by the world is not judged by a unit file's guards, while a unit file still refuses its own calls. A mixed-worker check needed.

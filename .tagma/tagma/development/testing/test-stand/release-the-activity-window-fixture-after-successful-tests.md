---
id: 01a1941f-f2bb-77f3-9717-6552f7c18c7c
title: Release the activity-window fixture after successful tests
ord: 29
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a188a5-13ca-7b6e-90ca-0f165186ea95
---
Reproduce the activity-window fixture teardown hang and identify the held resource before changing its producer. The historical failure remains unexplained; no timeout, hang guard, finalizer or production behavior was changed.

The original command is retained as execution `bddd051e-dd51-4d34-8fb4-f43d85c6a7f2:167` in thread `01a18896-d1d7-7a8f-9e41-11f033935b52`. Seeds 1 and 2 passed; seed 3 passed both tests and all 28 assertions, then a teardown hook reached 180000 ms. The file used 192.12 s wall and 114.3 s CPU, with 109.7 s charged to the world. The only observed child of Bun pid 56704 was the testbed reaper shell pid 56734. That process listing does not inventory Workers or identify the waiting finalizer; no stack/profile or per-finalizer observation of the hang was retained.

A faithful current run from `apps/tagma/server`, `/Users/teunlao/runlith/tagma/node_modules/.bin/testbed bun test --no-isolate --randomize --seed=3 ./src/composition/testing/native-harness/activityWindow.itest.ts`, execution `2a8cf2d3-f43b-4b43-8037-82afab3e67ca:167`, exited 0 with 2 pass, 0 fail, 28 assertions, 17.05 s wall and 10.4 s CPU. The own fixture's close completed without its release-report failure or a dangling-process verdict. This is one successful attempt, not evidence that the intermittent failure was repaired.

The close path was read at `packages/testbed/src/worlds.ts:ownEarly`, `packages/effect-test/src/runtime.ts:makeFixture`, `composition/testing/doorFixture.ts:built`, `composition/runtime.ts` and `composition/phase.ts`. The fixture's own scope owns the runtime, held SQLite pool and checked filesystem release. The activity-store shutdown was a concrete resource candidate: its existing real blocked-writer contract was exercised separately with `testbed bun test --no-isolate ./src/store/shutdown.itest.ts` from `packages/activity`, execution `4988bc24-ee65-48a4-8138-ca12a6086a39:167`, variant seed 511930062. It exited 0 with 1 pass and 3 assertions in 3.35 s, retained the typed connection-retirement failure and reported `[activity] 1 facts were not written before the store closed`. This refutes neither every body-worker failure nor every runtime-finalizer ordering issue.

Remaining work needs a currently reproduced hang with the hanging fiber/resource identified. The historical process and fixture are gone, so their missing stack cannot be recovered from the surviving command output. Preserve the original failure facts; a green seed or a deadline is not a teardown diagnosis.
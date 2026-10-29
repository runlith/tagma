---
id: 01a1231d-dbdb-762d-8fc9-2225377e8e5a
title: The SQLite storagePort runner returns to the 8 s CPU budget
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1231f-d7fd-7a6a-90e9-49889a3300a2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12313-c0d2-7404-bc73-bdc2bf798196
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/native-harness/storagePort.itest.ts
---
Speed up `apps/tagma/server/src/composition/testing/native-harness/storagePort.itest.ts`, keeping the core and SQLite shared conformance contracts, including Stop races with the opening refusal and reap. Measurement of October 10, 2026: without the two new race cases and the added broke branch in the rollback test — 124 pass, 0 fail, 9,377 ms CPU against the 8,000 ms budget; with the additions — 126 pass, 13,739 ms CPU. These are separate samples under different load; their difference does not measure the additions' price. Start with `openThreadStorage` and how often each conformance test creates the world; a shared per-file fixture or a copy of prepared state should remove the repeated assembly. Done after a full runner launch with explicit `--parallel=3`, no `[layers] … × budget` message, no contract cuts; do not restart the Tagma server.

Verified October 10, 2026: the runner uses one SQLite database per file, clearing threads with cascades and approval preferences before each case; the real close/open in the reopen contract kept. Samples with a prepared seed: before the change 10,358 ms CPU, after 4,306 ms CPU; random order with seed 377 — 4,395 ms CPU. All full launches kept 126 pass and 604 assertions, including race cases; the last two passed with no budget warning. The old storage.reopen consumer (`settlementRestart.itest.ts`) passed. After a neighboring migration was added, a cold build of the shared seed from 346 migrations together with the runner gave a separate 11,137 ms CPU sample; its cost is not removed. The server typecheck at verification time reported errors in the unfinished `plugins.itest.ts` and `threads/store/pins.ts`; the changed files gave none.

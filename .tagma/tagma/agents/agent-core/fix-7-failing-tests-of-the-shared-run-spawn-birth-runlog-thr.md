---
id: 01a12201-9ea8-734d-bb74-db92e8307e56
title: "Fix 7 failing tests of the shared run: spawn birth, runLog, ThreadSpawnTree fork, definitions, hook schema"
ord: 181
tags: ["task"]
fields:
  {
    "holder": "tagma:01a121d6-3d32-71e9-bb7e-606acf893aa6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a121e5-2700-7b99-ae65-295557f1fef4
---
The shared run after eff497e9da fails in code the delivery doesn't touch:
- `packages/agent`: three "spawn birth" conformance tests (idempotency on request id), the runLog test "an envelope accepted before a snapshot failure still reaches the next input boundary, once", the fork test in `ThreadSpawnTree`;
- `apps/tagma/server`: `definitions.test.ts` (standing grant sources) and "hook schema admits the row vocabulary and strips the unknown".

For each, find the commit that broke the test, compare against the graph contract, and fix at the root: code if the test caught a defect, the test if it holds a stale contract, delete if it protects nothing.

## Result (commit 7fbc99cdc4)

- spawn birth (3 tests): a code defect. 78f9c0e230 made keyed-act records of the InMemory adapter owned by the holder's thread, while SQLite keys them by evidence. Birth writes a record at the child and reads at the parent or by the new `childId`, so the repeat never found it. InMemory records key by evidence again, as in SQLite.
- For that difference 78f9c0e230 added an admission test "one key on two threads — two acts". On SQLite it failed before this work too. The contract [[9f3bb3f9]] is operation, caller and key identity. The test now proves: one act and a typed `ThreadActReused`, one run.
- fork in `ThreadSpawnTree`: the test held old code. Under [[0f8d8726]] a fork of a history-less thread refuses `transport-cannot` (78f9c0e230). The test checks `TransportCannot` with `capability: history`.
- runLog, the pre-snapshot-failure envelope: the test passed the pre-eff497e9da `to` shape (a string) to `execute`, while `execute` takes the decoded list.
- `definitions.test.ts`: the `harness` declaration (9231b2a793) doesn't declare conversation sources. The test required them of every declaration; now it checks the grant against `declaration.sources`.
- The hook-schema test was fixed by f84cdafb60 before this work.

System tests didn't run — that stays unproved.

Done when the `packages/agent` suites and the server unit tests pass whole (no more than 3 workers), and the work lands in a commit.

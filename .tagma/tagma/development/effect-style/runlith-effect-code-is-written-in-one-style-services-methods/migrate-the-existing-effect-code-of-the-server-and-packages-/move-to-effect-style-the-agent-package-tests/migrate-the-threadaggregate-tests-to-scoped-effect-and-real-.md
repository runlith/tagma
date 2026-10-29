---
id: 01a14079-6e1a-7662-b24a-af91fd58bae5
title: Migrate the ThreadAggregate tests to scoped Effect and real memory owners
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadAggregate.test.ts
---
Migrate `thread/run/ThreadAggregate.test.ts` to it.effect with the test scope and full memory storage contracts; keep visible snapshot/input/settlement, append replay, deletion, fork/birth, compaction and authority outcomes, remove bookkeeping/copy and swallowed failure. Verify the single file with a serial test, narrow typecheck and check_law, and land with no wait for an individual review; leave the a01ffa22 launch assembly unchanged.

---
id: 01a13ff4-89d7-7e47-a21e-ef13952dc763
title: Migrate the transition kernel tests to Effect and a typed memory fixture
ord: 21
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
    ref: packages/agent/src/thread/transition/kernel.test.ts
---
Migrate transition/kernel.test.ts to @runlith/effect-test with no direct runners, cast undefined storage or Date.now. Keep keyed replay/reuse, stale preparation and lane admission, rollback, birth/spent and coordinator-unit contracts. Read RacingThreadTransitions and the memory owner whole; remove the cast at the producer when the shape is clear, without widening the storage port. Checks: one file with --parallel=1, bun check -p packages/agent, law, one Sol+Muse round; evidence and diff to the parent before the commit.

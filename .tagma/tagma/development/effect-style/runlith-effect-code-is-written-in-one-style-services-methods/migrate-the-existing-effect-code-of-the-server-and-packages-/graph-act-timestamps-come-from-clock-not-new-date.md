---
id: 01a13d3a-fc47-7244-b382-7c176d6cf855
title: Graph act timestamps come from Clock, not new Date()
ord: 29
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f2e-523f-7ee2-9537-e8014a4925bd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d2f-397e-77cc-90c3-6f0408aa72d5
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/acts/records.ts
---
`graph/blocks/birth.ts:95`, `graph/blocks/update.ts:155` and `graph/acts/records.ts:25` write timestamps via `new Date()` inside the effect. Because of this `TestClock` does not move them: the body-history test waits a real millisecond (`it.live` and `Effect.sleep`), not `TestClock.adjust`. Found while migrating the graph tests (08aa72d5). The fix is time from `Clock.currentTimeMillis` at the act's owner, history tests on `it.effect` with `TestClock.adjust`. Done in `9c496402f1` (acts and recovery) and `b43bf9a7e6` (commit metadata, freshness deadlines, ledger). History uses TestClock.adjust with no real waiting; green checks cover history, merge/restore, echo expiry, background retries and batch. The overall server typecheck is not green over seven errors in three unrelated files; not repeated after the tail. One copy-freshness run exceeded 10 s; an isolated comparison of the old Date.now and the new Clock deadlines passed, the exact cause of that timeout unproven.

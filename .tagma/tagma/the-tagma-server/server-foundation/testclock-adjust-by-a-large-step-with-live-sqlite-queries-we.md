---
id: 01a12367-4cd2-7fd4-b885-726eecf6da2b
title: TestClock.adjust by a large step with live SQLite queries wedges the store in integration tests
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12367-642d-7a33-8526-004bc506d87c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12343-e01a-768f-bf26-816c4c312ffd
sources:
  - kind: file
    ref: apps/tagma/server/src/notify/notify.itest.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/clock.itest.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: apps/tagma/server/src/schedule/schedule.itest.ts
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
The defect is confirmed at the SQL owner: `platform/store/clock.itest.ts` before the fix exhausted the writer queue wait (`wait-ceiling after 900000 ms`) on a TestClock shift by a day and got an EffectDrizzleQueryError in 155 ms. Writer waits and the Close deadline are moved to the physical clock, watchdog and statement durations to physical monotonic time; the transaction body's domain clock stays. The owner test now proves a live transaction commit, a waiting INSERT, and the next write after the shift; notify proves week-long cleanup on a live layer, schedule proves no overlap on a shift past a day and the next tick, and the true persistence checks after restart stay. Server and sqlite-process typecheck pass, 35 affected owner/consumer tests pass; Sol xhigh ran one independent review with no findings. A repeat check surfaced a separate test-harness lifecycle defect — [[38a0cb77|TMPDIR task on --rerun-each]]; three independent sequential repeats of the shift scenarios pass, and the consumer fixture closes its fibers before storage.

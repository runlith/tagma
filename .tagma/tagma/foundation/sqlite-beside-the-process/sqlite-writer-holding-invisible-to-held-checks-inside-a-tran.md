---
id: 01a145f2-c8f8-71e3-949c-466858d1f4aa
title: "SQLite writer holding invisible to held checks inside a transaction: lock order and WaitUnderHold miss it"
ord: 11
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14564-656e-7e40-9f43-ef39c681ad09
sources:
  - kind: file
    ref: packages/held/src/Held.ts
  - kind: file
    ref: packages/sqlite-process/src/writerPermit.ts
---
Inside a SQLite transaction `Holding` is empty: the machine-database transaction body sees `liveHolds(Holding)` = `[]`. So the lock-order check and `WaitUnderHold` from `held` (`Flight`, `Section`, `Lane`, `Capacity`) do not know the server's most important resource — the database writer.

Why:
- `Held.lease` puts its token into the fiber context via `setContext`.
- Any `provideService` around a call restores the former context on exit, and the token lost.
- Around `lease` two of them: `Effect.provideService(Clock.Clock, …)` in `writerPermit.ts` and `Scope.provide(transactionAcquirer, scope)` in `makeWithTransaction` from effect/sql.

Probe: if the token passed into the transaction body (`writerPermit` remembers the open transaction's token, `client.withTransaction` puts it into the body's `Holding`), a nesting of different databases' writers immediately shows, which the rank model forbids — all writers rank 500:
- `ProcessPool.itest.ts`: database `b`'s transaction inside database `a`'s transaction.
- `concurrentGraph.itest.ts`: "an act crossing to another graph…" — an act on a mirror opens the `global` graph inside its transaction. Opening writes to the `global` mirror and the machine database.

What to decide:
- Writer order: a mirror's writer before the machine database's writer — each store kind its own rank.
- Graph opening does not run under another graph's writer: mirror → mirror nesting a real deadlock risk. Two acts each opening the other's graph hold their writer and wait for the foreign one.
- Other violations the full test run with visibility on will show.

Until done, `FreshnessGate.settled` judges the store's open units, not `Holding` ([[ce9b0fcf|refusal note]]).

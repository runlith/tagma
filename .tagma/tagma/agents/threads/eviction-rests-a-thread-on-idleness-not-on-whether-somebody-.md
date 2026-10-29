---
id: 01a0c673-b2a6-7463-92b5-d8fc9975b667
title: Eviction rests a thread on idleness, not on whether somebody archived it
ord: 111
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/harness/ThreadRollouts.ts
  - kind: file
    ref: apps/tagma/server/src/protocol/settings.ts
  - kind: file
    ref: apps/tagma/server/src/threads/contract/wire/eviction.ts
---
## What is wrong

A thread's projection leaves the database only after the thread has been archived for longer than the configured window. Archiving is a reader's organizational act — it says "I am done looking at this" — and it was made to carry a retention clock it never earned. A thread nobody archives therefore has no retention clock at all, however long it has been dead.

Measured on this installation, 2026-09-22, over a 17.68 GB store: 854 never-archived threads hold 6.86 GB — **39% of the weight has no clock**. The archived population that does have one reclaims 0 at the shipped 30-day default, because no thread here has been archived that long; 33% at 7 days, 20% at 14. So the mechanism that exists reaches, today, nothing at all, and could at best reach 45%.

## The change

Eligibility becomes idleness: a thread whose last durable movement is older than the window rests, whether it was archived or not. Archiving stays what it is — how a reader arranges a list — and stops being a retention gate.

Nothing about what a thread KEEPS changes. The safety contract stands exactly as written: no records leave until the rollout file provably holds them, and `no-file`, `unreadable`, `torn`, `cursor-behind` and `records-missing` keep every row they keep today. A thread with a standing run is never eligible. A rested thread reads back whole at the first door that opens it.

## The window: seven days of idleness

Measured 2026-09-22 over a store holding 39 days of work in 14.77 GB of folds — about 0.38 GB of new folds a day. A seven-day idleness gate puts 1 703 threads and 9.68 GB in scope today and leaves the last week's 5.09 GB standing; fourteen days would reach 962 threads and 5.15 GB. Read as a steady state rather than as a snapshot, seven days holds the folds near 2.7 GB plus the tables no thread owns, against roughly 7 GB at fourteen and a store that simply keeps growing at thirty. The safety contract costs nothing at that window: every thread has a rollout file, and the only rows it keeps are the six with standing runs and the twenty-five whose cursor is not yet at file size, all of them inside the last day.

Seven days is also the point where a thread is honestly dormant rather than merely quiet over a weekend, which matters because waking one is not free.

## What this is NOT justified by

Not write latency. The measurement that ran beside this one established that the store's slow writes are not SQLite doing work — a transaction of this shape runs at 2 ms against this very file, at any cache size, warm or cold. Retention here answers unbounded growth: 14.8 GB of database and 11.3 GB of rollout beside it for one month of work, with nothing that ever ages. Anyone who later argues this made writes faster is arguing past the evidence.

## What it does not settle

Whether three whole folds of one conversation need to stand simultaneously for a thread nobody has opened in months is a separate cut, and the larger one. This decision makes the existing mechanism reach the weight it was always meant to reach; it does not reduce what a live thread costs.

Two consequences to answer while building, not after: the window's own value, chosen from the measured distribution of weight by idleness rather than from the old default; and the drain rate — 300 evictions a pass against a backlog in the thousands is four days of sweeps before the store settles.

## Acceptance

A never-archived thread idle past the window rests and reads back whole; an archived one is treated by the same clock and no longer by a second rule; a thread with a standing run, or one whose rollout cannot be proven to hold its records, is kept with the reason it is kept today; and the measured backlog drains at a rate stated in the change rather than inherited.
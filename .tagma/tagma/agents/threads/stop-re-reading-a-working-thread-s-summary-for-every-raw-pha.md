---
id: 01a0e043-b965-77a8-ab52-bf07f1ffa252
title: Stop re-reading a working thread's summary for every raw phase flip inside one thinking spell
ord: 85
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0e02e-edf6-7a7b-aa3b-871ece75ea96
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/list/activity.ts
    symbol: ThreadActivityFeed
---
`ThreadActivityFeed` reports a change whenever the raw phase moves, so preparing → calling → reasoning → calling … inside one thinking spell each make `ThreadList` re-read `threads.summary` (a multi-join select with the said-line subqueries) and fan a row frame to every listener of the project — about 1 + 2R reads per spell with R reasoning blocks, per working thread. The row draws every one of those frames alike: it words the three phases as thinking and clocks the spell from `since` [[c90442f5]]. The cost predates the spell clock; the performance review of [[ce75ea96]] found it.

Start at `sameActivity` in `apps/tagma/server/src/harness/ThreadActivityFeed.ts`: a move inside one spell (same `since`, both phases of the thinking spell as [[259e549b]] groups them, same calls) could update the held activity without `onChanged`. Before that, establish which other row fields refresh only through these announces — context share, warmth, said line — and when the thread's state frame re-announces the row anyway; suppressing an announce must not leave one of them stale. Done when a spell's intra-phase flips cost no summary read and every row field still moves when it did before.
---
id: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
title: Thread state is a versioned projection its owner keeps exact; consumers take typed changes and narrow events instead of re-reading
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a190c6-c2c4-7288-bc4c-2bd289f7cc4a",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
---
Section A of [[2afe6fec]]: thread state becomes a versioned projection its owner keeps exact, and consumers subscribe to typed changes and narrow events instead of re-reading whole state per publication.

Measured at 5× on `815ad556` (one machine, after writer programs): the serving thread is the ceiling at 0.96 core, with throughput near 10 calls/s and an unbounded backlog. Its self time is Effect runtime 31.6%, Drizzle SQL building 18.8%, Effect schema 7.7%, tracer and ledger 4.5% and JSON 3.5%. That is per-statement and per-operation overhead, so statement count is the lever. A hosted `read` costs 158 statements: 73 own, 62 from `ThreadSnapshots.publish` re-reading the whole thread, 16 from `ThreadList.project`, 7 from activity. Thread open under that load reached p99 ≤2,048 ms; its exact cause (writer retry versus projection) is unproved, but A removes both from the open path.

What stands when done, as section A specifies:
- the three clocks per thread: change revision, journal position, live sequence;
- typed changes emitted by every program and unit that changes readable thread state, completeness enforced against declared write sets;
- one owner per projection applying changes in revision order;
- snapshot and `attachFrom` served from the projection at its cut, with bounded resident open entries and chunked transfer;
- hydration in one read snapshot;
- transient inputs on the same lane;
- the thread list, keep-warm and graph-copy holding on narrow events;
- the imperative `publish` calls gone.

Done when, in the bench's 5× run, `ThreadSnapshots.publish` and `ThreadList.project` carry no storage reads for changes applied incrementally, and A's correctness tests in the spec's Proof pass:
- shadow equality under random operation sequences;
- snapshot and `attachFrom` exactness under concurrent appends;
- hydration during commits and rewinds;
- several changes at one journal head across reconnect;
- an oversized open entry;
- refusal of undeclared writes.

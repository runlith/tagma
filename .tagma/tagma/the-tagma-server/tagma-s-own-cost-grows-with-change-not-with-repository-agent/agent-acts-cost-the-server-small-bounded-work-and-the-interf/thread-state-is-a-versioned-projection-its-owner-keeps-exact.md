---
id: 01a190c6-9088-7be5-8efe-8b03a3cb3d23
title: Thread state is a versioned projection its owner keeps exact; consumers take typed changes and narrow events instead of re-reading
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a194e7-71c1-7fa0-8aa8-0a7696d9c507",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/threadList.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
---
Section A of [[2afe6fec]]: thread state becomes a versioned projection its owner keeps exact, and consumers subscribe to typed changes and narrow events instead of re-reading whole state per publication.

Measured at 5× on `815ad556` (one machine, after writer programs): the serving thread was near its CPU ceiling at 0.96 core, with throughput near 10 calls/s and a growing backlog; the CPU profile adds overhead. Its sampled self time is Effect runtime 31.6%, Drizzle SQL building 18.8%, Effect schema 7.7%, tracer and ledger 4.5%, and native parse/stringify 3.5%. That is per-statement and per-operation overhead, so statement count is the lever. A hosted `read` in this sample carried 158 standalone SQLite sends: 73 own, 62 from `ThreadSnapshots.publish` re-reading the whole thread, 16 from `ThreadList.project`, and 7 from activity; these figures exclude SQL inside programs. A later count run recorded 157.95 standalone sends plus 34 statements and guards carried by two programs. Thread open under that load reached p99 ≤2,048 ms; its exact cause (writer retry versus projection) is unproved, but A removes both from the open path.

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

Delivery `ac74a52989` restores revisioned heartbeats and collected ACP step facts, with corrections for skipped heartbeat candidates, owned journal-form tails and stable display identity; [[546133ca]] describes its actual boundary. An isolated `b723b203d8` / all-eight-restored / `b723b203d8` A/B/A on one 12-core, 32 GB macOS machine with Bun 1.4.4 (50 agents, 5×, 15 s warm-up and 90 s measurement) completed 259 / 869 / 555 calls, with loop p99 154.66 / 127.93 / 185.99 ms. Saved ACP steps carried 79.50 / 50.67 / 79.82 combined standalone and program statements; hosted reads carried 148.62 / 131.98 / 139.54. The probe ledger had no evictions or detected gaps but still followed 1,718 / 1,137 / 1,464 roots, so those per-root figures describe the selected ended roots. The restored arm predates the delivery's correctness follow-ups. The historical regression was not reproduced and no individual culprit was established; the full A contract and the follow-ups' load result remain unproved. The thread list still re-reads its joined row and owed-work tables per state/phase event.

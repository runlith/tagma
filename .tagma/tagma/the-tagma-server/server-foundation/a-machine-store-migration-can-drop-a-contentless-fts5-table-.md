---
id: 01a19606-540c-709a-a2a2-5799e37e7c55
title: A machine-store migration can drop a contentless FTS5 table, so the orphan `transcript_fts` leaves the machine store
ord: 46
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1956f-d780-7c1a-8b6f-809c556ba27b
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/snapshotPlan.ts
---
Every migration on a real store takes a snapshot of the tables it touches (`snapshotPlan`), and the plan refuses any virtual table it cannot copy: `migration snapshot cannot copy table transcript_fts`. So migration `20261101150000_calls_leave`, which sets aside and drops the seven call tables, leaves the contentless `transcript_fts` in the machine store: nothing writes or reads it any more, but it keeps its index pages on every machine that recorded calls.

The snapshot needs a way to capture a contentless FTS5 table — through its shadow tables, restored after the virtual table is recreated — or a declared way to drop a derivable index with no copy. Then a new migration drops `transcript_fts`.
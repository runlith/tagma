---
id: 01a19107-6f1f-79c8-ad79-582909e79b08
title: Hot queries are prepared once and unsampled statement spans cost nothing, so a statement costs the serving loop almost nothing
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19438-d00e-77e1-ab7e-0c5c3fd9e78b",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: packages/sqlite-process/src/connection.ts
---
Section D of [[2afe6fec]]: a statement and a span cost the serving loop almost nothing.

In the profiled 5× sample on `815ad556`, the serving thread used 0.96 core while backlog grew, consistent with a serving-thread CPU ceiling on that machine. Its weighted self-time shares were Effect runtime 31.6%, Drizzle SQL building 18.8%, Effect schema 7.7%, tracer and ledger 4.5%, native parse/stringify 3.5%. Drizzle rebuilds SQL text and the row mapper on every call; each statement opens a span; rows cross the process boundary by structured clone and are decoded by schema.

What stands when done:
- the hot queries are Drizzle prepared queries with placeholders. Hot means ranked by count × serving-thread cost at 5×, measured, not guessed;
- queries that section A is removing (`ThreadSnapshots` whole-state reads, `ThreadList.project`) are left to A;
- one logical read needing several statements goes in one round trip where the store supports it;
- unsampled statement spans cost no attribute projection or byte sizing.

Done when the bench's 5× profile shows Drizzle SQL building and per-statement span cost at a small fraction of their `815ad556` shares, with per-act statement counts unchanged by this work, and the affected owners' tests green.

State on 2026-11-01: prepared program writes and guards (`d1c68f36`, `1073960f`) landed and were reverted with six other commits in `78b66892`, after a 5× run lost throughput (1,177 → 742 completed calls per 90 s) and loop p99 rose from 11 to 63 ms; the regression was not traced to a single commit, so preparation itself is not shown to be the cause. A live 23 s profile on 2026-11-01 still shows drizzle SQL building (`collectSQL`, `escapeName`, entity checks) on the serving loop.

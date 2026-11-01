---
id: 01a19107-6f1f-79c8-ad79-582909e79b08
title: Hot queries are prepared once and unsampled statement spans cost nothing, so a statement costs the serving loop almost nothing
ord: 8
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

Delivery `ac74a52989` restores the prepared program writes and guards and deferred SQL-span tails after a current-baseline A/B/A did not reproduce the historical regression; no individual reverted commit was established as its cause. Read preparation in `41dcb66e7` and `cfd74d290` already predates the `b723b203d8` comparison baseline, so the nine original construction-bench shapes are counterfactual costs, not remaining production savings. A profiled restored arm before the heartbeat/tail correctness follow-ups completed 452 calls in 90 s; 22 retained profile fragments covered 87,550 of 90,014 ms, with 20,172 samples. Under the analysis script's broad module grouping, Drizzle held 10.4% and telemetry 5.5% of weighted self time; these figures do not establish the completion gate. Remaining fixed transcript-planning and placement shapes are being ranked by construction CPU × census count before preparation; A's whole-state and list reads stay with A.

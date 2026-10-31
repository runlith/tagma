---
id: 01a12c8b-92e6-7ee7-9b2b-f9ef3751ed77
title: Measure and remove the edit_block cost growth on a large block with history
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a0e3b5-0899-7727-b5ac-a3e4ac005006
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/bodyDiff.ts
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/edit.ts
---
For `edit_block` on a ~174 KB body, compare sequential edits under equal load and different history lengths; separate permit and SQLite waiting from body diff, search index, and tree projection. The old 36–46 s measurement is not kept in reachable telemetry; the link to the scratch stale read is unconfirmed. On a separate tagma:try 5415a3bbb2-dirty 20261011T195435661Z, 174098 characters in a new untagged block, four sequential edits took 482, 307, 154, and 410 ms: that sample does not model the old load around 15 concurrent agents and a long history. Start with graph/blocks/edit.ts, update.ts, bodyDiff.ts, and graph/acts. Done when the root cause is confirmed by a trace/profile and fixed at its owner with a comparable measurement and a history-integrity check.

Measured 2026-10-12 on HEAD, a synthetic 174130-character body (720 lines, mixed EN/RU text, one-word edit): `bodyDelta` — 0–3 ms, `searchProjectionOf` — 25–37 ms. No work proportional to the block's history was found on the edit→update path: `assertStanding` — one successor query, `syncRefs` and `syncSearch` — proportional to the body, not history; `act.record` stores only the delta. The "history" hypothesis is not confirmed by code; the remaining candidate for the 36–46 s incident is writer/permit waiting under ~15 concurrent agents (not separated outside act.unit). Next step — trace one edit under load separating "waiting for unit" from "inside unit", not diff optimization.

2026-11-01: an isolated probe on the graph-tools fixture (native `edit_block` on a ~174 KB body, six quiet edits, then six under 15 concurrent create+edit writers, reading `writerMetrics.units` wait/hold/child per edit) did not finish: no output in 12 min 50 s, 317 s CPU, 2.6 GB peak, stopped by hand. Its peers waited on a busy `Effect.yieldNow` loop, so the hang is not established as product behaviour; the probe was deleted. Still missing: one completed loaded measurement splitting writer wait from hold for the large edit.

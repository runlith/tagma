---
id: 01a12c8b-92e6-7ee7-9b2b-f9ef3751ed77
title: Measure and remove the edit_block cost growth on a large block with history
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-876ef883c647",
    "status": "in_work"
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

2026-11-01: an isolated probe on the graph-tools fixture (native `edit_block` on a ~174 KB body, six quiet edits, then six under 15 concurrent create+edit writers, reading `writerMetrics.units` wait/hold/child per edit) did not finish: no output in 12 min 50 s, 317 s CPU, 2.6 GB peak, stopped by hand. Its peers waited on a busy `Effect.yieldNow` loop, so the hang is not established as product behaviour; the probe was deleted.

2026-11-01, completed measurement: `composition/testing/native-harness/editCost.bench.ts` (run from `apps/tagma/server` as `RUNLITH_SQLITE_HOSTING=child bun src/composition/testing/native-harness/editCost.bench.ts`). Native `edit_block` on one 174438-character block over the graph-tools fixture with child-process SQLite: 12 quiet edits, then 12 while 15 peers start on one Deferred and make a finite 30 rounds of create+edit each (900 acts, 5.4 s); each measured edit is its own cost root, read back from `writerMetrics.units`. One sample, 12 cores, load average 11–14 from other agents:
- quiet: wall 48–70 ms, writer wait 0–0.1 ms, hold 41–65 ms, of it 9–29 ms in SQLite statements and 32–41 ms outside them;
- loaded: wall 63–219 ms, wait 1.3–12.2 ms, hold 43–65 ms with the same split; the wall above wait+hold is time outside the writer unit while peers held the loop;
- no growth across the 24 successive edits of the same block.

Inline SQLite gave no overlap at all (the measured fiber never yielded to peers), so only the child-hosted run counts. Limited conclusion: on this fixture, at this body size and 15 small-act writers, the 36–46 s and its per-edit growth do not reproduce, and writer wait does not grow toward it. Not modelled: the incident's real mix of 15 agents (landings, graph pool opens, tree projection of a team checkout), a long journal, the server's own drivers. The ~35 ms the unit holds the writer outside SQL is the largest share of a large edit's hold; it is bounded by the body, under the loop threshold, and not a cause of seconds.

---
id: 01a10284-da13-7e0c-9742-a428bea4b992
title: read_block, shelf projection, update_block, and advance pay for their answer, not for the subtree, the shelf, or the graph
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a10289-9e81-7d00-9d11-fe1defc19bee",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/update.ts
  - kind: file
    ref: apps/tagma/server/src/graph/reading/block.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/selection.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/advance.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
---
**What.** Graph reads and writes pay for their answer, not for the whole subtree, the whole shelf, or the whole graph.

**Why (perf audit 2026-10-03).**
1. `read_block` at any depth reads the whole subtree: `reading/block.ts:91-290` (`readPage`), `search/selection.ts:344-403,536-544` (`shapes`/`outline` recursively without depth, then `select *` over all descendants) — records with subqueries, sources, verdicts, endings, authors, edges, refs, link parsing in all descendants' bodies, `globalNames`. Measured: `read_block(05042d40, 2f69b0c4)` — 4229 ms (span `50ddb09cf9e69446`, instance 57f3a082): 159 blocks, 3.2 MB of bodies. Project root — 1477 blocks, 5.5 MB. The same SQL in sqlite3 — 6–7 ms: expensive round-trips, body IPC, and JS processing.
2. `tree/projection.ts:251-262` runs `select * from block where parent_id = ?` for `shelfNames` — the bodies of all shelf neighbours inside a writer transaction under the tree permit (at f658e190 — 66 neighbours, 2.47 MB). A likely contribution to [[ac005006]].
3. `blocks/update.ts:208` unconditionally calls `syncSearch`: a status, field, or parent change re-tokenizes title, body, and sources.
4. `serving/advance.ts:36-44` does `rebuilt` before the steps, `projectToTree` of the whole tree, and `rebuilt` again; the first graph resolve after a restart costs ~9 s (`invocation.admit` 9443 ms, `Graph.advanceTree` 8770 ms, instance 1a70c631).

**Direction.** shapes — an aggregate in SQL; rows, bodies, and facts — only down to depth; refs and globalNames parsing — only for what is shown. Shelf — only id, uuid, title, ord, path. `syncSearch` — only when title, body, or sources change. Advance — a single rebuild.

**Done when.** `read_block` depth=1 on a large module reads rows of only the shown blocks; editing a block on a large shelf does not read neighbours' bodies; a text-unchanged update does not touch FTS; advance does one rebuild; read_block answers and the file projection are unchanged.

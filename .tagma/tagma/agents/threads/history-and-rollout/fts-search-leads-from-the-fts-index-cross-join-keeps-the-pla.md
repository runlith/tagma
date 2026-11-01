---
id: 01a131cf-a368-7686-bedf-e7fa7e0eb929
title: "FTS search leads from the FTS index: `cross join` keeps the planner from running MATCH on every scope row"
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a131c7-7066-7782-84b6-278a389eaa72
sources:
  - kind: file
    ref: apps/tagma/server/src/calls/store/matches.ts
  - kind: file
    ref: apps/tagma/server/src/graph/search/ranking.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/conversationReads.ts
---
The shipped SQLite runs without `sqlite_stat1`, and a plain `join` hands table order to the planner. A scope condition (`thread.project_id in (…)`, `block.project_id = …`) looks selective to it, so it leads the query from that table and checks FTS with a `rowid = ? AND MATCH` probe on every scope row. FTS5 runs such a probe as a full MATCH anew, so the cost becomes "scope rows × MATCH cost": project-conversation search took minutes. SQLite does not reorder `cross join`, so the query is led by the FTS index on `rowid desc`, which is also the page order.

Price of the choice: with a small scope and a frequent word FTS-first scans all corpus matches, but does only a primary-key lookup per match. That cost is bounded by the match count, while the reverse order grows with scope size and MATCH weight. Block search in `graph/search/ranking.ts` and call search in `calls/store/matches.ts` keep the same order. Call search also cuts that cost: a batch takes a fixed number of FTS matches in a subquery with `limit` before the scope and speaker filters, and returns each with a flag for whether it passed them. So one read costs the same at any scope, and the page, the `more` count and the `total` stop on the number of matches viewed and the time budget between batches.

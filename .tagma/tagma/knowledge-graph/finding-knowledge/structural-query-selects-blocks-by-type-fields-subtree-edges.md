---
id: 01a14bc5-0df5-77c8-b1a2-69369c55efea
title: Structural query selects blocks by type, fields, subtree, edges, paths, and measured facts
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6937cc0e28a3
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/search/selection.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/acts/measurement.ts
    symbol: measuredCondition
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/query.ts
    symbol: blockQuerySchema
---
**Value.** Questions like "which tasks under this spec are blocked" or "which blocks are not anchored to this catalog" are answered by one query instead of word search and hand sorting.

**How.** `query_blocks`; the same query saved in a block becomes a view.

**Behaviour.**
- Selection by type (exact, with descendants, or by supported contract), by field and status words, by subtrees, by source paths and their absence, by edge to a block (direct or transitive), by holder, and by freshness.
- Selection also by facts the server computes: whether work is blocked, whether a block is replaced, whether a spec is under construction, whether a reflection is answered.
- Sort order is set explicitly, including by work-end time. Resting blocks hide until asked for.
- The answer returns rows without bodies and the total match count.

**Limits.** The query itself is not saved: that is what a view is for.

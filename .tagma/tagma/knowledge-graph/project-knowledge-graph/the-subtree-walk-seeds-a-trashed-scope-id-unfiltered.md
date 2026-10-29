---
id: 01a0caad-20f2-7853-8fb2-73fff594accb
title: The subtree walk seeds a trashed scope id unfiltered
ord: 136
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/search/selection.ts
    symbol: scopeCondition
---
`Selection.subtree` and `scopeCondition` seed their recursive walk with `select ${scopeId}` unfiltered, so a trashed scope id stands in the answered set; only the walk below it is live-only. (The `live blocks only` comment the seed contradicted was stripped in c6f42a3059; claims [[2abc0371]] and [[a689acec]] now state the unfiltered seed as the behavior.) Harmless while delete stays a subtree batch (claim [[16756420]]) — a trashed seed then has no live descendants to wrongly include.

Done when the seed filters the trashed id or a test pins the seed behavior.
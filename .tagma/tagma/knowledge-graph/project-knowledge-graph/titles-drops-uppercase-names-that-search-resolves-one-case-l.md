---
id: 01a0cab7-5e5d-7747-9e7f-6e222bfdc927
title: "`titles` drops uppercase names that search resolves — one case law for both roads"
ord: 139
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/search/selection.ts
    symbol: selectionLayer
---
`Selection.titles` — the door every `[[name]]` the app renders resolves through — matches `compact.endsWith(name)` case-sensitively, while `Ranking`'s name arm lowercases the query first. An uppercase name therefore searches fine and resolves nowhere: `titlesAcross` passes body spellings through un-normalized, so `[[5940EDC1]]` renders a dead reference though a live block bears the name.

Done when one case law holds on both roads — normalize at `titles` or at its callers — proved by a test resolving the same name in both cases through `titles` and `search`. Claim [[f9db89c4]] states the lowercase-only behavior until then.
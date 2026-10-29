---
id: 01a0caaf-4566-797a-8d2c-6b97c9dc1f65
title: Batch handle grammar disagrees across `register`, the body rewrite and payload filing
ord: 146
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/amendmentOps.ts
    symbol: register
---
A batch handle's grammar is enforced in three places that disagree. `register` accepts any non-empty `$id`; the body rewrite matches only `[[\$([A-Za-z0-9_-]+)]]` — so a handle with other characters resolves in id positions yet stands literal in bodies with no refusal. And `assertAmendment` stores a payload `$id` verbatim while resolving references stripped of `$`, so `$id: "$a"` — which `register` explicitly accepts as `$a` — fails payload filing with `amendment-ref`. The `$id` schema itself is a bare string, so all three spellings reach all three gates.

Done when one grammar is declared (in the schema or beside `register`) and all three gates enforce it: filing refuses what the rewrite cannot rewrite, and `$`-prefixed ids behave the same in a payload as in a batch.
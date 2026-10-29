---
id: 01a0cb07-ced5-7267-8d71-2ede39ecc23b
title: A served mirror is filled by a hand-written table list, so a table added later is silently absent from every mirror
ord: 147
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0ca97-13f4-7e9f-bc7a-210182167fbe
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: moveProject
---
`moveProject` copies the machine's rows into a served graph through sixteen `insert into … select` statements naming their tables one by one (`apps/tagma/server/src/http/MirrorBuilder.ts:554-569`, `moveProject` at :545-580); nothing derives that list from the schema, so a project- or block-keyed table added after it is simply empty in every mirror, and the open's `foreign_key_check` cannot see the omission — the missing rows are absent, not dangling. The comment that used to justify `target_snapshot` standing in `db/thread.ts` by a mirror scrub walking that module's exports is gone — no `mirror` stands in that file anymore — but the omission itself is still neither guarded nor accepted. Done when the copy is derived from the schema or guarded so a new table cannot be forgotten, or the omission is accepted.
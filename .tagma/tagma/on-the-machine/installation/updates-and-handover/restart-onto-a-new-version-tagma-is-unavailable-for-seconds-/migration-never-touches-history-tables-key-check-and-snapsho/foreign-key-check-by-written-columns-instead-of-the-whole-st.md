---
id: 01a126b9-6a5d-780b-8049-421edbf2cadc
title: Foreign-key check by written columns instead of the whole store
ord: 1
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ec9631d38c
sources:
  - kind: symbol
    ref: apps/tagma/server/src/platform/store/chain.ts
    symbol: applyMigration
  - kind: symbol
    ref: apps/tagma/server/src/platform/store/keyCheck.ts
    symbol: checkKeys
  - kind: symbol
    ref: apps/tagma/server/src/platform/store/keyPlan.ts
    symbol: keyPlan
  - kind: symbol
    ref: apps/tagma/server/src/platform/store/writes.ts
    symbol: reachedWrites
---
Spec section "Key checks": a plan by what the migration wrote, down to columns; trigger consequences answered by the walk from `platform/store/writes.ts`, and its own output in `chain.ts` deleted; an unparsed operator gives a typed open refusal instead of a whole-store pass. The history-table law never enters here — it lands after the baseline migration. Start with `platform/store/chain.ts` (`applyMigration`), `keyPlan.ts`, `keyCheck.ts`. Done when the key checks from "What the implementer proves" pass and the store with the current chain opens as before.

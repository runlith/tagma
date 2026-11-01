---
id: 01a196db-341a-7c0a-9804-2f599f4ffa55
title: Signed relocation returns its source journal range after departure
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19595-3043-740f-9cf7-9474573600a0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a196c4-e242-7ea0-97a4-269b83c5b282
  - kind: waits-on
    to: 01a196fb-0b48-78bf-b865-846fad128298
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/journal/callRange.ts
  - kind: file
    ref: apps/tagma/server/src/invocation/journaled.ts
---
A signed two-store move can return journalUnreadable although the source depart event was recorded: departure renames the source row, then call-range decoration resolves the returned former name in that source store. Confirm the full native-door chain and fix journal identity at its owning boundary while preserving source authority, destination provenance, resumption and ordinary per-block call filtering. Prove the actual signed response red before the fix and green afterward, including its source range and departure; assertions must observe the journal fields the existing generic door helper strips. The range must retain its own source block/copy address through the answer and diff consumers: pairing it with the moved block's destination copy selects a different journal. Any required wire-contract and consumer migration belongs to this same producer-owned fix. Run only affected checks and one independent review after author checks.
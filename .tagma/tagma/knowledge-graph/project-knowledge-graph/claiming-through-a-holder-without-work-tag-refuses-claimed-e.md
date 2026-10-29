---
id: 01a0caaf-4555-7475-a8a9-d0fda84e9966
title: Claiming through a holder-without-work tag refuses `claimed-elsewhere` for a concurrency that never happened
ord: 133
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/work/tasks/holding.ts
    symbol: taskHolding
---
The atomic take guards on `roleAt(table, 'work', 'initial', ...)`, and where no tag binds the `work` role that condition is `0` — so the update matches nothing and the claim refuses `claimed-elsewhere`: `task was claimed concurrently`. Nothing was concurrent; the tag simply binds a holder without work. Shipped `#task` binds `work`, so only project-declared holder-without-work tags meet the lying refusal — after passing the holder, standing and transition gates that all said the take was legal.

Done when claiming through such a tag refuses with what is actually wrong (no claimable work binding, naming the tag's words) instead of a concurrency the caller cannot answer — proved by a test over a holder-without-work tag.
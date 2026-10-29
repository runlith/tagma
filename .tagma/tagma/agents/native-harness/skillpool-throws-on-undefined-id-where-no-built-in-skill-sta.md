---
id: 01a0cabb-b125-7be1-92b3-660173d85328
title: "`skillPool` throws on `undefined.id` where no built-in skill stands"
ord: 34
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/native-harness/skills/pool.ts
    symbol: skillPool
---
`skillPool` destructures `[own, ...alsoOwn]` off the built-ins and reads `own.id` unconditionally. Two built-ins exist today, so nothing throws — but a build with none fails destructuring into `undefined.id` instead of refusing a composition that cannot pool. The youtube comment none states the non-emptiness the code assumes.

Done when an empty built-in list refuses (or asserts) with the reason, instead of throwing on `undefined`.
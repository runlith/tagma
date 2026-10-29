---
id: 01a17c0b-658f-73f3-9f7e-2dc61c4c5257
title: A testbed-budget waiting command may enter with a share for a neighbour already giving units away but still holding the queue entry
ord: 20
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a17c03-5070-7fca-87bc-ba30496d08da
sources:
  - kind: file
    ref: packages/testbed/src/slots.itest.ts
  - kind: file
    ref: packages/testbed/src/slots.ts
---
A static-review finding of the [[496d08da]] analysis (2026-10-27), unreproduced. In `slots.itest.ts` › "runs share the machine budget at entry…" `first` and `second` already wait in `acquireUnits` while `alone` ends. The CLI tail (`keep()` in `cli.ts`) gives units back as workers leave, and `release()` in `slots.ts` closes units before removing the queue entry. Into this window a waiter sees two neighbours, asks `ceil(8/3) = 3` and enters at once on free units. The share can never grow later, and the test requiring `[4, 4]` turns red.

Decide by the budget owner's code: whether this is correct entry-time admission behaviour (then the test must order by fact) or an admission defect counting a leaving neighbour and entering on a partial share.

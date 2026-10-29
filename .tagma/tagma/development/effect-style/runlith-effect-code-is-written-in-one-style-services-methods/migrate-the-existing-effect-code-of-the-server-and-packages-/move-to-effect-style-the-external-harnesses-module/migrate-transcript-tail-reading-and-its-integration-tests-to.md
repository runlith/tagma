---
id: 01a13f1e-046e-76d1-ba0a-d22817cd6bb2
title: Migrate transcript tail reading and its integration tests to Effect shape
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/ends/read.itest.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/ends/read.ts
---
The first external-harnesses migration group: `ends/read.ts` and `ends/read.itest.ts`. Keep tail reading across chunk bounds, Unicode, the turn window and Absent/Unreadable answers; keep the HarnessEnds.read span and file ownership, move the fixture onto the @runlith/effect-test layer. Proof is effect-style ends/ 0, ends/ typecheck and tests green, an independent review and a diff with numbers before landing on the operator's word.

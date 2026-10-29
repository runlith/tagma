---
id: 01a16b3a-adf4-760b-b38e-434443284bfb
title: "Fix the red enforcement tests on HEAD: remeasurePasses.itest, baseMerge.itest, landing.stest"
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16b3a-f536-7f37-9f6f-67b51fb152cd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16b08-3df5-7646-870f-b2aa7eb43056
---
Found by [[7eb43056]] on 2026-10-24: they fail with the fixture's old graph rows too, so not because of the pool.
- `apps/tagma/server/src/enforcement/remeasurePasses.itest.ts` — interrupt on driver restart;
- `enforcement/baseMerge.itest.ts` — expects `rule-violated`, gets `walk-cut`;
- `enforcement/landing.stest.ts` — 2 tests, `lines-held`.

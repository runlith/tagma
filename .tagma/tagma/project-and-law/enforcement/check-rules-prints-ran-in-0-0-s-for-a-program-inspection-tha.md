---
id: 01a15e24-bb7c-71f4-bf3e-41c3320acd1c
title: check_rules prints `ran in 0.0 s` for a program inspection that actually ran
ord: 158
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15e24-f83e-7df8-a042-6caa0a0c4657",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15ba1-aa7b-74a8-925f-7d97a38d657a
---
In law-lab `check_rules` on rule `39/4e5d1446` (ESLint `no-console`, a program from the checkout) found the violation in `packages/domain/src/money.ts:8`, but the rule row showed "ran in 0.0 s". A program inspection's duration never reaches the answer or is measured in the wrong place. Find the duration producer and fix it so the `check_rules` answer, the landing refusal, and Rules show the true run time.

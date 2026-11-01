---
id: 01a19467-e4e8-71a1-8d36-6e0d143fd544
title: A submit_work refused for a missing declaration index stays refused after the check_rules over "all" its unblock names
ord: 172
tags: ["reflection"]
fields:
  {
    "actual": "check_rules over all answered \"no violation\" in 11.8 s, yet the second submit_work refused inspection-failed for 13 gated rules with the same \"declaration index holds no revision within 5000 changed files of 82c4be976f\" error; the only exit left was a plain git commit",
    "command": "submit_work paths [apps/tagma/server/src/composition/testing/native-harness/editCost.bench.ts] at HEAD 82c4be976f, then check_rules over \"all\" rules [8fcfef49], then submit_work again",
    "expected": "After check_rules over \"all\" for a declaration-inspection rule, as the refusal says, the declaration index holds HEAD and the second submit_work judges the change"
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-31T23:25:28.662Z, from 3a395b0b3.

The checker is checks/law/declarations/index.ts::ensure (line 241), reached through checks/law/architecture/vendors.ts::affected. check_rules reported that builtin inspections ran from server build 3a395b0b3 and programs from the checkout; whether check_rules over all populates the index the submit_work judging reads (same root, same revision key) is not established.
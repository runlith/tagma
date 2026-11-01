---
id: 01a19467-e4e8-71a1-8d36-6e0d143fd544
title: A submit_work refused for a missing declaration index names no rule or key that builds it, so the caller guesses
ord: 172
tags: ["reflection"]
fields:
  {
    "actual": "The unblock said only \"check_rules over all for a rule of the declaration inspections\"; check_rules over all with 8fcfef49 (an effect-style rule) ran clean and built nothing, and the landing kept refusing until check_rules inspection dead-code over change, named by another agent, built the index",
    "command": "submit_work paths [apps/tagma/server/src/composition/testing/native-harness/editCost.bench.ts] at HEAD 82c4be976f, then check_rules over \"all\" rules [8fcfef49], then submit_work again",
    "expected": "The refusal names the inspection key or a rule whose check_rules builds the declaration index for this revision, so one call unblocks the landing"
  }
---
The landing was refused by 13 gated rules with "the declaration index holds no revision within 5000 changed files of 82c4be976f" (checks/law/declarations/index.ts:241, via checks/law/architecture/vendors.ts:112). Picking 8fcfef49 from the refused list was the caller's guess: it is not a declaration-inspection rule, so the named exit was not actually taken, and this does not show that the exit fails for a declaration rule. `check_rules {inspection:"dead-code", over:"change", paths:[the landing path]}` built the index, and the same submit_work then landed dfc99e8a78. The friction is the unblock text, which names no key or rule among the 13 it refused.
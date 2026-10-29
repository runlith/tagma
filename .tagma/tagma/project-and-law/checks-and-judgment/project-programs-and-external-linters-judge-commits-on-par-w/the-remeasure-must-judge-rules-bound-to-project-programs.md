---
id: 01a14c37-8de4-7192-a313-0273f4560718
title: The remeasure must judge rules bound to project programs
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-4469-7c3d-8bc5-6184496910db",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c14-a11c-7ce8-9d84-633b841d0f08
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/remeasure/rule.ts
---
The remeasure skips checks bound to external programs (`isBound` in `remeasure/rule.ts`). Their debt is never retired, and a violation slipped past Tagma by a plain `git commit` is not recorded as an escape. Running a program from the shared tree is separate task 50f3baec. The consequence showed on the `runlith-law:effect-style` rules: after moving the code to the style of 6 rules, they held 5621 stale escapes and 1173 debt records for four days with 0 violations on HEAD, until rewritten through enforce_law in [[97277b07]].

A full program run over the reach takes about 5–7 s per rule (one measurement on this machine), with seven rules on one runner, so the remeasure after each landing judges only changed paths, like the landing's sliced court, not the whole reach.

Proof: the remeasure retires vanished debt of a program check and records an escape.

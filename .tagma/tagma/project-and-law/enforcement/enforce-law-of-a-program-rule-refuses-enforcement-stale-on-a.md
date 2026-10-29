---
id: 01a15128-b3ed-7e98-b803-5cefbca4f00f
title: enforce_law of a program rule refuses enforcement-stale on any HEAD shift, including a neighbouring enforce_law's graph commit
ord: 89
tags: ["reflection"]
fields:
  {
    "actual": "All 6 refused enforcement-stale: \"changing 1 path(s) its measurement or pack-use check stands on: .tagma/runlith/effect-make-const-self-this-self-this.md changed\" — a graph commit from enforce_law 8fcfef49; 6 measurements of ~5–6 s wasted, the rules had to be enabled one by one",
    "command": "enforce_law {blockId: \"bc8f1e15\", base: \"a3524bf84559\", strictness: \"gate\"} (plus 5 more runlith-law:effect-style rules) in parallel with enforce_law 8fcfef49",
    "expected": "A HEAD shift outside the rule's reach (apps/tagma/server/src, packages) does not stale the measurement; parallel enforce_law calls of neighbouring rules pass"
  }
---
Filed from project `runlith`.

For a bound inspection `inspectionBase` yields '', so the freshness check treats any repository path as the measurement's footing, including `.tagma/**`, which shifts with every session's graph commits every few seconds. Under graph load, an enforce_law of a program rule with a 5+ s measurement may never pass at all. Project runlith, session 01a15121-44dc-7153-9d21-31ce6f788e20, 2026-10-18T22:34Z, HEAD e018b45d → 0670b74d.

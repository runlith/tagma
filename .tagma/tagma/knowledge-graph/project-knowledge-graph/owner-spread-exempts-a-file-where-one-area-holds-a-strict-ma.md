---
id: 01a0de1c-a3b1-7fb5-bc71-1ef43a67fb9f
title: owner-spread exempts a file where one area holds a strict majority of the claims
ord: 144
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de0b-e628-77a6-bcd4-36645b42e26f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c99a-9f09-7fff-aa2b-27ae976d54ac
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/measure/checks/ownerSpread.ts
    symbol: ownerSpreadCandidates
---
Doctor's owner-spread fires on claimant-area count alone (`owners.length >= 5`), so a file one area decides with 28 claims and four others cite once reads as ownerless — see [[976d54ac]]. Standing queue confirms it: anthropic-messages.ts 29 vs 2,1,1,1, bash.ts 27 vs 4,2,1,1,1,1 all flagged, while genuinely spread numbers.ts (1×6) flags the same way.

Change `ownerSpreadCandidates` (apps/tagma/server/src/graph/measure/checks/ownerSpread.ts) to skip a file where the top owner holds a strict majority of the claim count — owners arrive sorted desc by claims from `Sources.ownership`, so compare top against the rest. No new figure: majority is structural, not a tuned knob; the 5-area gate stays.

Done when a dominated file (5+ areas, top > rest) files nothing, a truly spread file (no majority, e.g. 1×5) still files on the common ancestor, and an exact-half split still files — pinned by an itest beside the owner-spread case in Doctor.ownership.itest.ts; claim [[b41f25ff]] re-read against the new gate.
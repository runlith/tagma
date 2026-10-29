---
id: 01a1767f-39ae-767b-8cd6-f4beab6b7cac
title: After landing, the fold used to recognize landed HEAD lines by text and could attribute the remainder to the wrong edit
ord: 75
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17649-5aac-796f-b4a0-9033e9160ee2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a17648-cb2e-75fc-b4e3-abd0dfcaaf81
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: alignBase
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: headRoot
---
After landing, the fold used to recognize landed HEAD lines by text and could attribute the remainder to the wrong edit.

After landing, HEAD is no longer the version the fold recorded, and `headRoot` aligns the fold's base to it by text (`alignBase`: common prefix and suffix, unique anchors, Myers). Among equal lines it could continue the wrong base line: a landed line reads as a base line someone deleted, while the real base line reads as deleted. Then the remainder line goes to the wrong edit or to nobody, the landed holder keeps a phantom line, and its next landing on that path rewrites the text again.

Example (block-fuzz, seed 268, functions): base n0, n1; A deletes n1 and appends n2; B deletes n0; C inserts n3 before n2. After A lands (`n2, n0`), prefix alignment identifies the `}` of base n1 with the `}` of n0 in HEAD, and B's slice leaves an extra `}`.

Measured after the slice fix on shortened pairs ([[bf2012e8]]), 3000 cases × 3 orders: 229 chains break on a late landing (before the fix — 361 late and 2066 first ones); in 115 of 21087 steps a landed holder keeps a hand, and its repeated landing would have changed the text. That is why holding on the shortened pair is only taken on a traced HEAD, and on a text-aligned HEAD a peer whose single line shortened against someone else's stays invisible.

Direction: landing knows which HEAD lines it kept and which working lines it added. That origin must reach the next judge — for example as the landed text snapshot the fold finds by digest — rather than being recovered by aligning text.

Done (a187b6af03): landing records the composition of the landed text, and the judge assembles HEAD from it ([[9f26b778]]); insertions in the slice land after the HEAD line their point stands after ([[bf2012e8]]). Measured block-fuzz, 3000 cases × 3 orders: without retirement there were 108 late breakages, now 0; there were 64 phantom hands, now 0; there were 61 harmful phantoms, now 0. After retirement there were 148 late breakages, now 127; the remainder is the cold fold, moved out to [[76a1124d]]. The imprecise order of first landings stays at 544: that is the "left or right of a deleted line" ambiguity.

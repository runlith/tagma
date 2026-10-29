---
id: 01a108d5-b6e7-74ce-8139-10ea04aa5cd5
title: "Layer: a held chain reads the neighbouring rung where its sources stand under the shared parent"
ord: 43
tags: ["task"]
fields:
  {
    "status": "open"
  }
---
Port the `@runlith/layer` fix into its twin package (runlith commits df6d797292 and b0fcd5b00c).

Defect: the neighbouring rung's key (same parent), requested from a held scope (`hold`), is refused with `TierMismatchError`, although its sources stand under the same parent. Example: holding `desk:e` under `visitor:7`, while `room:a` stands by sources; `resolve(Table, desk.scope)` must answer `room:a`.

Fix in `inChain`: besides the "from is an ancestor of focused" case, focused answers when the `from` chain passes through a rung-scope whose parent is focused's parent, and that scope belongs to another rung (`at.tier !== focused.tier`). Another kind of the same rung is not a neighbour: holding `Visitor.guest()`, sources naming user 7 — the user-tier `Account` from the guest scope is still refused. A section-scope (no tier) under the same parent and a chain under another parent are refused too.

Done when red-then-green tests in the twin's ladder tests prove both cases (the neighbour answers, the other kind is refused), and the rest of the layer tests pass.

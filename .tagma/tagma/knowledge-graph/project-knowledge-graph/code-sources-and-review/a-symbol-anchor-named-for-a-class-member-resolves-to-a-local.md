---
id: 01a0c710-ab19-712e-92c8-c6e705d364ea
title: A symbol anchor named for a class member resolves to a local const of the same name inside a method
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "Line 54 alone: `const part = this.parts.get(id);`, a local inside `apply`. The declaration scan matches a line-leading `const` at any nesting depth, and a file's declaration matches win over its member matches (`constructRegion` returns declarations when there is at least one), so the local shadows the member it shares a name with. `symbolSite` still answers `defined`, so the anchor attaches and nobody is told: the source would ring drift when `apply` is edited and stay silent when the member moves.",
    "command": "regionsOf('packages/layer/src/Snapshot.ts', lines, 'part') — the symbol region reader of apps/tagma/server/src/graph/measure/sources/symbol.ts, run over packages/layer/src/Snapshot.ts",
    "expected": "The region of the static member `static part = Layer.member( () => Snapshot, (snapshot, part, key) => snapshot.add(key.id, part), );` — lines 19-22 — so a claim about how a member is wired measures the member's own lines."
  }
---
Filed from project `runlith`.

Met while writing the zone for [[ebcfb470]]: the claim "a part joining through Layer.member travels under its member key's own id" is established at line 21 of Snapshot.ts, and no anchor names it. `part` resolves to line 54, so the claim was bound to the class symbol `Snapshot` (14-70) instead — broader than the claim, and named in the report as an anchor that could not be confirmed.

The region reader's own test suite may already pin the declaration-before-member order for the top level; what is not covered is a name that is both a member and a local in another member's body — the case a registry like this one produces, where `add`, `take` and `apply` all bind `part` as a parameter or local.

`parts` and `applied` resolve correctly (24, 27) because no method body declares them.
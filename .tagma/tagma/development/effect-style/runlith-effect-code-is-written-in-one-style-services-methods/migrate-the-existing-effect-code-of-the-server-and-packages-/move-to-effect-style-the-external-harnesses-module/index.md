---
id: 01a13f16-1128-7f09-9a38-ea1d23d2ccf0
title: "Move to Effect style: the external-harnesses module"
ord: 34
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13f16-3817-7139-a4eb-84cd102afa14",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/external-harnesses
---
The production code and tests of `apps/tagma/server/src/external-harnesses` follow the `effect4` skill. Proof is zero effect-style findings for the module, module typecheck and tests green, spans preserved.

Remaining step: when `HarnessImplementations` becomes effectful, give `SessionBirths` a tag; until then `makeSessionBirths` takes dependencies by tags and returns the previous contract with no new tag.

---
id: 01a13be8-c38c-7f61-871f-39a55e564b19
title: "Move to Effect style: the worktrees module"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13be9-049e-739b-adf8-1515855513bd",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/worktrees
---
A trial migration wave. Scope: `apps/tagma/server/src/worktrees/` — production code and tests (measurement 2026-10-14: 65 code sites, 25 in tests). Proof is zero effect-style findings for the module, module typecheck and tests green, spans preserved.

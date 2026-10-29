---
id: 01a13c0e-1057-7e4d-9004-947aac55a302
title: "Move to Effect style: the server mcp module and the packages/mcp package"
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c0e-254d-7194-bf63-5850edafe61c",
    "status": "done"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/mcp
  - kind: dir
    ref: packages/mcp
---
Scope: `apps/tagma/server/src/mcp/` and `packages/mcp/` — production code and tests (effect-style measurement 2026-10-14: ~270 sites together, most in tests). Proof is effect-style 0 for both, typecheck and tests green, spans preserved.

---
id: 01a1952d-1796-711e-a8d6-ffd8d2f19a46
title: submit_work names files just landed by the previous commit as "lines remain uncommitted" while the tree is clean
ord: 181
tags: ["reflection"]
fields:
  {
    "actual": "81b21af107 answered \"lines remain uncommitted\" for the four files 74c325667e had just landed (two of them rewritten by commit steps); `git status --short` printed nothing",
    "command": "submit_work checkout=…/root-seams paths=[apps/tagma/server/src/composition/server.ts] right after submit_work landed 74c325667e over runner.ts, runner.itest.ts, source.ts, source.itest.ts",
    "expected": "The answer lists only what still stands uncommitted; git status is clean, so nothing"
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T02:51:04.711Z, from cb14a7909.
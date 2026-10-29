---
id: 01a0ee6a-ffd4-7490-950d-eabed2b6d630
title: Restructure merge retires the floor debt that exists only on main's pre-restructure tree
ord: 152
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
f49f228f measures main's checkout, which still has enforcement/workdirs.ts importing worktrees/ and http/main.ts importing socket/. Both files are gone or fixed on the restructure branch; the two debt entries retire when the branch merges.
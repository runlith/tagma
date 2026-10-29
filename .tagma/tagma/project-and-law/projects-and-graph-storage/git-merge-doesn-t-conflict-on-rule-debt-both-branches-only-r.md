---
id: 01a14c14-a11c-7ce8-9d84-6329a4b68d2d
title: Git merge doesn't conflict on rule debt both branches only reduced
ord: 9
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63363d3e5239
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63387548cc1d
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/cli/merge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/graphMerge.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/mergeDriver.ts
---
**Value.** Two branches, each having removed some of the existing violations, merge without manual reconciliation of the rule document, while a genuine law change still conflicts and requires a decision.

**How.** The `tagma-graph` merge driver Tagma registers together with the commit gate; `tagma merge-driver` — the command git runs.

**Behaviour.**
- The driver reconciles only debt: a record each side lowered or removed gets the minimum or vanishes; everything else merges line-wise with `git merge-file`.
- Registration lives in the git dir and the checkout's local config; it changes no tracked files.
- Without Tagma installed, the script behaves like an ordinary line-wise merge.
- A worktree merge check reconciles debt inside the server without running the CLI per file.

**Limits.** Diverging escapes, changes of strictness, inspection, or owner, and debt growth conflict as usual. The driver attribute covers the repository's `.tagma` files, i.e. the team tree.

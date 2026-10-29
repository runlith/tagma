---
id: 01a127c5-712d-75ac-a9f9-f0c48eb313d5
title: The sidebar keeps a thread with active descendants outside finished
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127c4-d8b3-7cc3-8468-6ff33ac50c1a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e613bda205
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/forest.ts
---
Fix the subtree-life computation in forest.ts and folding in tree.ts: a thread stays in the main list while it or any descendant is non-idle, including stalled and descendants in another worktree. Verified through the public ThreadForest operations and the column and worktreeGroups projections: a descendant's working, awaiting and stalled keep idle ancestors outside finished; the last active descendant leaving, reparent and remove update the state. 55 focused tests passed and scoped svelte-check of the changed files with no errors or warnings. The full app typecheck never finished within the 1 min limit. Fixes landed in 3c7e57fc15 and 4ab348330f.

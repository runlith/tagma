---
id: 01a15417-b33a-7058-b932-71f2b7502f04
title: The platforms rule does not re-walk the graph when changed files do not change the load graph
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15419-5394-73d2-a177-567c8edc5d20",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15417-4ea3-7cfd-8032-89c71b48552d
sources:
  - kind: dir
    ref: apps/tagma/inspection/src/packs/js/platforms
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/inspecting.ts
---
Right now a one-line edit in `apps/tagma/server` costs 1.7 s on a warm base and 3–8 s in a landing: the package's contribution resets wholesale. Take two steps.

1. When nothing the walk reads changed in the changed files, the base's verdict carries over to the new tree with no walk. This covers imports and exports, `package.json`, route options, and file makeup.
2. Otherwise only what depends on them is recomputed.

Correctness beats speed: an edit adding a forbidden import still yields a violation with a chain, and a test proves it. Separately, find out why a landing meets an almost-cold cache when the previous landing already judged this tree (740 ms plan in landing vs 11–84 ms warm). Remove the cause at the cache's owner. Proof — a before/after sample.

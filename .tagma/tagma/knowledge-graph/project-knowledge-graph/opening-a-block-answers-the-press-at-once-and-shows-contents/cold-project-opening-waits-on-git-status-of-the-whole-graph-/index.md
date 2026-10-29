---
id: 01a14c3d-ab9b-7368-9676-3720a6b4b6b7
title: "Cold project opening waits on git status of the whole graph tree: 2.7 s on 16.7k blocks until the git index is updated"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c68-ea99-75cf-80ea-5e561320d6d3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
  - kind: implements
    to: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
  - kind: implements
    to: 01a14c5a-4c1f-719c-8aa5-3b838d8a01b6
  - kind: waits-on
    to: 01a14c68-75fc-7268-bf0d-39b2d620c9b9
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/freshness.ts
    symbol: treeSeen
---
Measured 2026-10-17 on a trial server (one sample, machine under ~14 load): first opening of a team project with a ready mirror (16.7k blocks) after a restart — `GraphPool.open` 3.3 s, of which `FreshnessGate.settled` 2.5 s, and inside refresh 2.7 s is the tree's `Git.status` (`treeSeen`, `--untracked-files=all`). The same `git status` from the shell — 0.13–0.5 s; with `GIT_OPTIONAL_LOCKS=0`, as the server calls it (`platform/git/ownGit.ts`), the first run is 3.5 s: without optional locks git does not write the updated index and rehashes files on stale stat data every time. This is the remainder of the law [[c57e2aa9]] for a cold project: opening a block in it after a server restart costs seconds and grows with the tree.

Find how to make cold-tree freshness O(changed) instead of O(tree) without touching the user's checkout index under their git commands; start with `graph/tree/freshness.ts#treeSeen` and `graph/serving/freshness.ts#refresh`. Proof: measuring the first `read_block` in a cold project of the same size at < 1 s.

---
id: 01a162ca-04c9-7a97-b516-594af7cb9d6c
title: "One navigation engine per repository for any worktree count: a worktree snapshot as a diff layer over the base"
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a162fe-ce39-701c-80f4-cdd660a2e485",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a1612d-2135-7f12-8deb-91b934378e8f
---
Operator decision: navigation works exactly at any worktree count, eats little, runs fast, with no duplicates and no lags; the machine budget guards against overspend, it does not cap the worktree count (spec, "Any worktree count, no duplicates"). Today the holder raises one engine per `RootId` (~4.5 GB on runlith), and the 32 GB machine gives exact answers to only two worktrees. Rebuild: one engine per repository; a worktree snapshot is a `fileSystem` layer of its diffs from the base over shared parsed files and programs, worktree paths translate to base paths and back; each worktree's changes, HEAD, and agent writes go to its layer; idle worktrees' type caches release first. First measure on runlith — memory and answer time over 1, 3, and 6 worktrees with small diffs, the 74-place benchmark through a layer, an own edit in a worktree, layer price on branch divergence — then build it in the adapter and holder from the layout. A lockfile or dependencies diverging from the base is spec's open question 6: serve with the same engine, a separate engine only when there is no other way, and say so.

---
id: 01a1314e-8669-7c79-ba5c-b972b643584f
title: A new branch's twin forks from the branch on whose own first-parent line its base lies
ord: 4
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/topology.ts
    symbol: baseOf
---
A branch cut from `release` shares an equally deep merge-base with every branch containing that commit: `release` itself, a neighbour cut from the same commit, and a branch that absorbed `release` by merge. Their graph lines differ: only `release` has the current graph. So among the deepest candidates wins the one whose base lies on its own first-parent chain, with the recorded fork point (`tagma-forks.json`) neither the base itself nor above it on that chain. The fork point comes from the branch reflog's oldest record — its true cut, not the tip at the first sync: a branch that made code before the first sync would otherwise look cut at the base. The code never distinguishes its own commits from others' fast-forwards, so between two "own" candidates wins the one whose twin contains the other's twin — its graph is strictly fuller; the old shadow-commit-count tiebreak goes last. Without this a worktree from `release` received a sibling branch's graph, 12 days stale, and re-merged branches `release` had long absorbed.

A branch whose twin already stands among the tracking refs the graph's exchange supplies, under the same name and sharing the graph history, starts from it: that is the same branch's graph from another machine.

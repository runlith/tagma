---
id: 01a1ab7a-4047-76b0-bda9-de5150909c8c
title: A path that misses every root retakes the coverage of a linked worktree git added outside Tagma before the miss stands
ord: 33
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a1318c-8979-71d8-afe3-2a452086e7fd
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
    symbol: makeCheckoutPathService
  - kind: symbol
    ref: apps/tagma/server/src/workspace/roots/coverage.ts
    symbol: makeCoverageLedger
---
A project's coverage learns its linked worktrees only when something retakes it — the worktree list while a client watches it, a thread's birth, a terminal's target. A worktree made by a plain `git worktree add` outside Tagma stayed unknown until then, so a path in it missed every root: the commit gate's `tagma check --gate` there answered `not-found` (a person's commit went through unjudged, an app landing a move refused it as unjudged), and file writes there were placed outside every checkout.

So a miss in `CheckoutPaths` asks `Coverage.coverAcross` before it stands: the nearest `.git` above the path is read from disk; when it is a linked worktree (its git directory names a different common directory), the registry's own place resolution (`Projects.resolve` over the key in the common directory) names its project, that project's coverage is retaken, and the lookup runs again once. A `.git` directory, a missing or unreadable marker, or a repository no project holds answers no.

The check runs before the miss cache (`missedAcross`, `outsideOf`): a directory once seen outside every root can later receive a worktree at the same path — an app recreating its scratch worktree each run — and the cache would hide it. Its cost on an ordinary miss is one stat per directory up to `/`; git and a coverage write run once per new worktree. A worktree no project took is remembered until the registry or any coverage changes, so misses under another repository's worktrees do not resolve it again.

Boundary: only a miss asks. A linked worktree created inside another covered checkout's tree is not missed — its paths fall to that enclosing root — and stays so until coverage is retaken; walking up from every placed path to catch it would cost a stat walk on the hottest lookup.

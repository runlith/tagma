---
id: 01a178f3-aaad-707b-b257-8e3768f2942f
title: A remote branch merges into the tree by fast-forward, and a merge commit is born only on real divergence
ord: 11
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a179a7-5ae0-7899-b62e-35cda941dfc7/01a178cf-eabb-7a2a-92d7-493ea4e99427#runlith-private
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/topology.ts
    symbol: syncTopology
---
Two machines on one remote always see each other's commits. If a remote branch the local history could simply catch up with merged via `merge --no-ff`, each side would birth a new merge commit on every exchange, and the machines would forward merge commits to each other forever. So when the tree HEAD is an ancestor of the remote branch, the tree moves by fast-forward and no commit appears. On real divergence the merge goes like a code-branch merge: format adoption, recovery worktree, conflict — recovery with a banner; the other machine takes the resulting merge commit by fast-forward.

A remote branch merges in after the code-branch merges, and only while no recovery waits: with a waiting recovery `merge` would refuse anyway. While the tree's recovery stands, a new remote branch never even marks topology "due": otherwise every exchange round seeing the divergence would wake topology again, and it the exchange, and they would spin each other forever. A codeless code branch (fresh `git init`) also merges the remote branch in: the topology read asks about it then too. A remote branch older than the base shape stays stranded, like such an incoming code branch. A folder without git (one tree on `main`) merges the remote branch in the same way.

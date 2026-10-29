---
id: 01a11bd7-b4eb-7669-89f6-1ede1dc0dcda
title: A stealth graph remembers the repository of a checkout after its code worktree is deleted
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/shadow.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/topology.ts
    symbol: syncTopology
---
A code worktree can vanish while its graph worktree still holds the branch and unwritten files. The tree's belonging is kept in the metadata shadow Git, so a cold opening frees the branch inside the same repository, keeping the remaining tree's files. Another clone's tree and a tree with no established belonging never free automatically: absence from the current worktree list alone never proves the owner.

Beside the repository, the tree also remembers the checkout it serves. When that checkout is gone from the repository's worktrees, any same-repository tree's sync drops its graph worktree — but only a clean one, untracked and ignored files included, with no pending merge, and under that tree's tree permit so no act writes into it mid-deletion: unwritten files and recovery matter more than disk space. The checkout leaving the worktree list marks topology reading due, so the sync arrives with the repository's next ref movement. A departed branch's twin deletes only if its tip contains a remaining branch's twin; otherwise it is stranded — its graph commits lie nowhere else. Without this, deleted branches' trees and twins accumulated forever, and `git branch -d` in the bare shadow judged "merged or not" against a HEAD usually absent there. Cleanup leaves a dropped-tree receipt that newly serving this path cancels: a missing folder alone never permits deleting the mirror; its cleanup also awaits the twin's disappearance. Tree dropping, twin deletion, and copy release wake mirror cleanup again: the pass after a code worktree deletion could catch a still-live tree or its holder.

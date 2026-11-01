---
id: 01a194fa-e0be-7317-a467-02056d378b98
title: "A graph tree's directory standing empty is checked out from its branch: only a directory with files keeps them when its git is reattached"
ord: 24
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a194da-0b50-740d-b7a4-277b4513994a
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/shadow.ts
---
Attaching a graph tree whose directory stands without a `.git` marker keeps the directory's files: such a tree is taken for one that lost its worktree registration while holding the graph's own unwritten acts, so the branch is registered beneath it and whatever the files lack reads as deleted in the next commit. That holds only for a directory with content. An empty directory is never a worktree that lost its registration — git's worktree always leaves its `.git` file in it — and empty layer roots do stand: the projection creates a team project's stealth root before its layer is born. Healing over one made the layer's whole branch read as deleted, so the tree's batch committed the deletion of every stealth block which the next exchange round would push to the remote. So an empty directory is removed and the branch is checked out into it as into a missing tree.

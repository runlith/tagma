---
id: 01a14c14-a11c-7ce8-9d84-6325d41fd6a2
title: "The graph follows code branches and worktrees: a branch has its own version of knowledge, and merging code merges the graph"
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-929587c73bc6
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-63271278b347
  - kind: relates
    to: 01a14c14-a11c-7ce8-9d84-6329a4b68d2d
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/shadow.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/pool.ts
    symbol: makeGraphPool.viewOf
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/topology.ts
    symbol: syncTopology
---
**Value.** Knowledge written on a feature branch doesn't reach main before its code and isn't lost after merging: the graph lives on the same branches as the code it's about.

**How.** Automatic — on graph open and on repository reference movement. `list_branches` names the branches the project graph is served on; the window reads it to know the project's branches.

**Behaviour.**
- Team: the graph is ordinary branch files, git leads them together with the code; a thread call by default reads its working checkout's copy.
- Stealth: a new code branch gets a graph twin branched from the branch it was cut from. When the checkout's HEAD absorbed another branch, its twin merges into the current one's twin; before merging, the incoming graph is brought to the target graph's form so a format difference yields no false conflicts.
- A deleted branch's twin is removed only if its commits already lie in a remaining branch; otherwise it stays untouched.
- A departed worktree's tree is removed only if it has no unwritten files and no unfinished merge.

**Limits.** In a folder without git, stealth keeps one tree; after git init it follows branches and worktrees. A checkout's own graph tree on detached HEAD reads from a brought-up temporary copy freed with the pool record; in stealth without such a tree, the main checkout's copy reads. A write from a detached place refuses with the exit of moving to a branch or targeting the main copy. An unresolved stealth merge conflict becomes a recovery case; in a team merge the driver names the files where the branch change yielded to the base.

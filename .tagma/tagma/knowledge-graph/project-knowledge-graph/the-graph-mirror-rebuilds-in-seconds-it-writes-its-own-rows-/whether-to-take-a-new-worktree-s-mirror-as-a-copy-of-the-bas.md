---
id: 01a13ba2-803d-7614-a6da-3532c3a19bd5
title: Whether to take a new worktree's mirror as a copy of the base's mirror repaired by diff instead of a rebuild
ord: 1
tags: ["idea"]
fields:
  {
    "status": "closed"
  }
---
Question: take a new worktree's mirror as a copy of the checkout it was cut from, repaired by tree difference (`repairMirror`), instead of a full rebuild.

Why consider it. A new worktree's graph is almost always the base's at cut time, while a rebuild derives it whole anew. A file copy plus repairing a few changed files does not depend on graph size.

What decides the choice:
- The runlith-tree rebuild time after [[1e154af5]] under several simultaneous starts. If it is seconds, a copy does not pay for its risks.
- What in the mirror belongs to the place, not the graph:
  - the `event` journal (trash uses it to find batches, `purgeUnjournaled`);
  - the `tree-head` stamp, the mirror revision `tree-mirror-revision`;
  - task holders, trash.

  Each would have to be reset or carried, and a silent mistake corrupts the graph.
- Whether a new worktree's graph tree matches the base's: its graph branch forks by its own rule ([[b643584f]]), and there is [[fe7a2454|the reflection]] on cutting from a stale line.
- Consistent SQLite copy under the base's live writer (`VACUUM INTO` or the kit's `export`) and its cost on a large graph.

Uncertainty: neither the copy time nor the share of cases with a small tree difference is measured.

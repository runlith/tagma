---
id: 01a10b25-dbc8-7f63-8d9a-df4dc0df57c0
title: "A worktree merge is judged by the merged tree's graph: if both sides changed the graph, merge first takes the base into the branch and judges the worktree's graph"
ord: 1
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/landing/merge/integrate.ts
    symbol: integrate
---
Where the graph is stored in the tree (team storage), a branch carries its own #module cards and law documents: new modules, links, entries, allowances. Judging by the base's graph would refuse every branch introducing a module or allowance, though its commits already passed judgement by its own graph.

Merging is judged like a commit: a rule applies as held by the graph of the tree being landed. So strictness and debt come from the branch's graph — softening on the branch done openly via `enforce_rule` and visible in the `.tagma` diff, and after merging the same document still judges the base's next commit. Ordinary debt carries into a file clean in the base too: the source branch's tip confirms the violations standing there, at most the accepted debt's `count`. The counter counts inspection units, not their `sites`: one accepted unit carries all its places. It frees no violations outside debt; a vanished fingerprint in it and growth past the counter stay new. So a remeasure that turned held debt into ordinary debt after landing does not change merge's outcome. A separate "base law" over the branch's graph would be a return of accepted law, removed by the [[16819c00]] decision.

Before reading the branch's tip, merge delivers its pending graph by the same owner as `sync_graph`, honoring `graph.commit`: otherwise judgement would see accepted debt in the mirror while the branch carried the old document. Undeliverable refuses with a way out; with `graph.commit = off` refusal stands until the graph files are committed. The branch's graph equals the merged one only while the branch holds all base graph changes. Graph commits go into main almost continuously, so this condition holds for seconds. If the branch changes the graph while the base changed it too since divergence, `merge_worktree` first takes the base into the branch: a merge-commit on the branch with the already-counted merged tree (parents — branch tip and base tip, no hooks — the final commit runs them), the branch ref moves compare-and-set under its checkout's commit lane, worktree files brought by `read-tree -m -u`. After that the worktree's graph is the merged one, and it judges — after forcing its mirror's settle: the watcher would see new files later, and judgement would read the old rules. The ref shift, file bring-up, and ref rollback on git refusal go uninterruptibly, so a lane cut never leaves the branch on U with tip files. Assembling the merged graph from the tree on every merge instead would be seconds of synchronous event-loop work.

Uncommitted worktree work on paths written by the base take refuses before writing (`source-held`, `source-dirty`), and the branch stays put; git that refused to bring files after the ref shift returns the branch. A refusal arriving after the base take says the branch already holds it — the merge does not redo it. The base's graph judges only when the final commit's hooks themselves change the graph. Uncommitted graph edits in the base checkout do not enter judgement: the merged tree does not carry them.

Where the graph is stored outside the tree (stealth, plain), the branch's graph merges after merge via twin or shared, and the base's graph judges.

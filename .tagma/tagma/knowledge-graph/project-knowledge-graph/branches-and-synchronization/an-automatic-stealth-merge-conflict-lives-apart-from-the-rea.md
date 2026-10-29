---
id: 01a11c14-39f3-70c0-b916-2e3dd45a015d
title: An automatic stealth-merge conflict lives apart from the readable graph
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/merges.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/topology.ts
---
Merging runs in a detached recovery worktree: a conflict keeps both sides and the index, while the served branch stays readable. An unfinished merge left in the served tree moves over at opening together with the working files. A record beside the shadow Git survives restart. Before the merge outcome it is journal only and shows no recovery: otherwise every clean merge would flash a banner. An attempt interrupted before the outcome is dropped whole by `restore`, and the next merge starts over; the record becomes a recovery only on conflict. The recovery of a branch deleted from this tree's repository drops at the next sync of any same-repository tree: nobody serves its target anymore, and without this the notification would hang forever and the door would refuse `no-checkout`. A deleted incoming branch's recovery drops only if its twin already lies in the twin of a branch the repository holds, or is already gone — the twin deletes under the same condition. A remote branch's merge recovery drops only together with its target: its incoming is a remote tracking branch, not a repository branch. Otherwise that branch's graph would remain only in recovery: `delete_worktree` deletes the branch even after a conflicted graph merge. The twin is judged, not `theirs`: the format-adopted `theirs` is a commit outside branches. A recovery with an assigned thread and a record whose move from the served tree was interrupted stay: the thread finishes the first, the second drops at its tree's sync after `restore`. Dropping runs before recovery reading, so a dead record never stops the same sync's merges. Another clone's tree keeps its recovery. Publication requires readable block files and a format marker, and inclusion of the incoming and the current target. A new target must never be overwritten by a stale resolution.

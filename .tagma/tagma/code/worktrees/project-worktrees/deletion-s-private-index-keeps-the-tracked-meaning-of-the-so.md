---
id: 01a13f8b-cc18-711d-a539-ad000516e2ab
title: Deletion's private index keeps the tracked meaning of the source index and never walks ignored directories
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/worktrees/retirement/delete.ts
---
A file may be staged against its parent directory's ignore rule. Its work must be kept: a repeated `add -A` from HEAD's index refuses on the parent, while a wide `-f` captures ignored descendants when a tracked file is replaced by a directory. So the original tracked membership is carried over only for selected stage-0 entries, tracked paths update separately from untracked ones; the rename's old path joins the same kept work.

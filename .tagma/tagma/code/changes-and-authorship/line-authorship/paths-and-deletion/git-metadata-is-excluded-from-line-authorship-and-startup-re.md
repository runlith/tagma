---
id: 01a12660-3a7a-7e84-8f23-1843130d561c
title: Git metadata is excluded from line authorship, and startup removes its erroneous holdings
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/record/metadata.ts
  - kind: file
    ref: apps/tagma/server/src/change-record/serving.ts
---
Git service files are not part of the working tree: their absence in HEAD proves no `untracked` edit by an agent. Intake and Holdings exclude `.git` and the actual gitdir/common-dir, including a worktree's separate gitdir; unresolvable metadata resolution leaves a typed failure or stale state. Change-record startup removes erroneous rows on those paths and releases references to their texts while keeping the files themselves; it reports an unfinished cleanup and retries it at the next startup.

---
id: 01a1297e-6270-712c-b784-0d794033e3b9
title: After a merge commit made by another session, submit_work lists ~48 merged paths as this session's uncommitted lines while git and read_changes say none are held
ord: 7
tags: ["reflection"]
fields:
  {
    "actual": "The answer listed 48 paths \"lines of this session still stand uncommitted\" (merge-resolved files, main-only files like packages/utils/src/json.ts, and packages/execution-host/src/timingResume.itest.ts/.writer.ts this session never wrote); read_changes at the same moment says \"This session holds 0 paths\" yet lists those same turn paths as `held`",
    "command": "submit_work paths=[\"packages/sqlite-process/src/checkpoint.itest.ts\"] in worktree tagma-holder-impl-f0e304, after the merge this session resolved was committed (0171056747) by its parent via `git merge --continue`",
    "expected": "Landed 13cd6685b5 with an empty `left`, since every resolved path is in the merge commit and `git status` shows them clean"
  }
---
Filed from project `runlith`.

The merge itself (`git merge main`) moved 2139 files and they were all attributed to this session. The two timingResume files belong to a peer executor in the same worktree. The contradictory answers cost a verification round (git status per path) before the final report could state what is held.
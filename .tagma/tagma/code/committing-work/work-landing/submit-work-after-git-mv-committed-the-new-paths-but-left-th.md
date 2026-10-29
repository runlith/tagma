---
id: 01a0d69e-6399-7196-9baf-42d6c1e50a06
title: submit_work after `git mv` committed the new paths but left the old paths' deletions and stale staged copies in the index
ord: 66
tags: ["reflection"]
fields:
  {
    "actual": "Commit 7b80c8c7f6 added the 13 new paths but removed only 9 old ones (the 4 old paths not listed in `produces` were not held by the session); the index kept the 4 staged deletions and 10 staged pre-edit copies of the new files, so a later plain `git commit` would have reverted the edits. Recovery took `git restore --staged`, restoring the 4 files from HEAD, deleting them through the `delete` door and a second commit (2f29f268e7); submit_work on the absent paths first answered \"nothing to commit\".",
    "command": "bash `git mv a.itest.ts a.stest.ts` ×13 (with `produces` naming the new paths), edit some moved files, then submit_work with `paths` naming old and new paths",
    "expected": "One commit carrying each rename whole (old path removed, new path with its current content), and an index matching HEAD afterwards"
  }
---
Filed from project `runlith`.
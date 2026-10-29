---
id: 01a18745-8035-7554-91b6-fa5bb14d1306
title: submit_work on an open merge refuses lines-held for declarations the merge's incoming side brings, one file per call
ord: 150
tags: ["reflection"]
fields:
  {
    "actual": "Refused lines-held naming declarations from main's side (ENDINGS/signals in ownWork.ts, then makeEndingSignals in store/endingSignals.ts) as 'held by nobody', one new incoming file per retry; the merge was landed with plain git commit (9bb7496b)",
    "command": "submit_work(checkout: feed-e2e worktree, paths: [resolved conflict files], whole: [those files]) with `git merge main` open and its index resolved",
    "expected": "One merge commit carrying the index's incoming changes and the conflict resolutions, since the tool's contract says an open merge with a resolved index lands as a merge commit carrying the incoming changes"
  }
---
Filed from project `tagma`.

The merge took 60 commits of main into a branch 45 ahead. The incoming files were staged by git merge and already committed on main; the dependency gate read them as uncommitted declarations nobody holds. Each `unblock` only names the next file, so the walk would cover every file main changed that a resolved file imports. Commit 9bb7496b in worktree feed-e2e.
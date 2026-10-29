---
id: 01a11803-50ce-7bb2-a919-a3e44612f58f
title: After merge_worktree followed by submit_work, the main checkout index holds stale versions of committed files
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The index held blobs from 5f69d42556 (the version before 7b4a080436); the working tree matched HEAD → git status \"MM\" on 7 files that read_changes attributes to nobody. A plain `git commit` would have rolled back the S3 fixes. A manual `git restore --staged` was required. Nearby remained 9 files where the working copy differs from HEAD only by formatting (commit steps \"unreadable\" on the old server), attributed to nobody.",
    "command": "merge_worktree changes-holdings → main (342ee58649), then submit_work s3-fold (7b4a080436), changing the same 7 files in change-record/lines",
    "expected": "The main index matches HEAD for the files submit_work committed; git status does not show them"
  }
---
Filed from project `runlith`.

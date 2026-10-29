---
id: 01a16eb3-7566-74c7-be1c-a4e6a8487e3b
title: read_changes counts unchanged files from reachable commits as rolled back
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "All three paths are marked withdrawn (reverted), and both commits are missing from the commits section HEAD reaches; the files and commits themselves are not lost.",
    "command": "read_changes({\"limit\":100})",
    "expected": "drive.itest.ts and drive.test.ts are marked committed 5b89ffae38, CLI worktree.itest.ts — committed 93d7bbd33a: both commits are reachable from HEAD, and their files stand with no later changes."
  }
---
Filed from project `runlith`.

Checked in /opt/workspaces/runlith: git merge-base --is-ancestor for 5b89ffae38 and 93d7bbd33a returns 0. git rev-parse for HEAD:path and the matching commit:path gives identical blob pairs: drive.itest.ts e881fb32c7321e9e2a65b68c1424afe54905a558; drive.test.ts 6b8ed690708be0c8c5279a9c07b306231edbf4c2; composition/testing/cli/worktree.itest.ts 18574b0768168d2d294c8f225ccdbc41b876f2e6. This thread's submit_work had returned both commits before. That is a wrong current change-record verdict, not a tree rollback.

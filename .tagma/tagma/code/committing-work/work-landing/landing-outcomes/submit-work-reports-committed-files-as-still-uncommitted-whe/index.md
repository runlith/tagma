---
id: 01a12ae4-c289-755a-947c-056b27d7f3f5
title: submit_work reports committed files as still uncommitted when the shared index holds a stale staged version
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "Answer listed 8 files as 'lines of this session still stand uncommitted' though `git diff HEAD` was empty for them; `git diff --cached` showed 13 files staged with older content reverting commits 6f2c35d/212970f. Cost: ~5 extra calls to tell index from tree; unstaged with `git restore --staged` by hand.",
    "command": "submit_work paths=[11 files] whole=true in worktree tagma-holder-impl-f0e304",
    "expected": "Landed answer lists only paths whose working text differs from HEAD; a stale staged index is named as such (or ignored), since commits go through the commit tree"
  }
---
Filed from project `runlith`.

Nobody in this session ran `git add`; the staged older versions came from some process in the shared worktree. Besides the misleading report, a plain `git commit` by any peer would have silently reverted landed work.
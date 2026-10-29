---
id: 01a16e28-d821-7db7-bc73-ad48a8f49dea
title: read_changes loses the commit after formatting and names the standing lines reverted
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The answer has no 7cb7a9133e; baselineTail.itest.ts and chain.itest.ts are named withdrawn (reverted), baseline.itest.ts assigned only to the earlier 37fccfbe08; git confirms 7cb7a9133e is an ancestor of HEAD and its lines stand.",
    "command": "read_changes({limit:20})",
    "expected": "Name commit 7cb7a9133e and its work's three files as committed: the commit is reachable from HEAD, and sharedPool stays in the current files."
  }
---
Filed from project `runlith`.

submit_work returned 7cb7a9133e for platform/store/{baseline,baselineTail,chain}.itest.ts and reported the commit steps reformatted all three files. The following read_changes({limit:20}) skipped that commit and showed two files' lines as reverted. The `git merge-base --is-ancestor 7cb7a9133e HEAD` check exited 0; `git log` on those three files shows 7cb7a9133e first; grep sharedPool finds its import and bindings in all three current files. The wrong entry forced a separate git check instead of trusting the change record.

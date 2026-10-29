---
id: 01a12976-4626-72c0-8eed-74db54f35a0e
title: "A sub-agent cannot conclude a git merge: bash commit asks review it cannot wait for, and submit_work refuses mid-merge"
ord: 88
tags: ["reflection"]
fields:
  {
    "actual": "Refused no-approver: \"bash needs an answer, and this run cannot wait for one\"; submit_work refuses any commit while a merge is in progress, so no door concludes the merge and the five executors in the worktree stay blocked from submit_work until a parent commits by hand",
    "command": "bash `git commit --no-verify -q -m \"Merge main into the holder line\"` in worktree tagma-holder-impl-f0e304, run by a depth-2 child during an operator-ordered merge",
    "expected": "The merge commit lands (the operator ordered the merge), or the act asks an approver and waits"
  }
---
Filed from project `runlith`.

The merge index was fully resolved; the only remaining act was the commit. The unblock offered "ask the operator to run it", which costs a round-trip through the parent while every submit_work in the shared worktree refuses.
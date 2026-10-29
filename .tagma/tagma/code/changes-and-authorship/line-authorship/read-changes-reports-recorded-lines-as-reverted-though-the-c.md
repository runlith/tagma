---
id: 01a16dfa-c8a7-7d17-a5df-7016e4b563f1
title: read_changes reports recorded lines as reverted though the commit stays in HEAD
ord: 113
tags: ["reflection"]
fields:
  {
    "actual": "Answer: holds 0 paths, lines that left: reverted 1, path withdrawn (reverted). Git confirms that 37a1cce3c4 is an ancestor of HEAD and HEAD contains the changed test; git status of the path is clean.",
    "command": "read_changes({limit:20})",
    "expected": "Show packages/execution-host/src/MachineLoad.itest.ts as committed in 37a1cce3c4, with no held lines."
  }
---
Filed from project `runlith`.

Checked with a single command: git log -1 --format='%h %s' 37a1cce3c4 && git merge-base --is-ancestor 37a1cce3c4 HEAD && git status --short packages/execution-host/src/MachineLoad.itest.ts && git show HEAD:packages/execution-host/src/MachineLoad.itest.ts. It completed successfully; the current HEAD contains the narrow test from this commit.

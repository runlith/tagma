---
id: 01a1284c-fa45-7a15-b073-dc74e8abf3bc
title: submit_work names “lines of this session still stand” in files where the session's own read_changes sees no held path
ord: 79
tags: ["reflection"]
fields:
  {
    "actual": "submit_work listed 9 paths in left (activation.itest.ts, holder.rs, main.rs, spawn.rs, lib.rs, host.ts, nativeLaunch.itest.ts, pipeLaunch.ts, posix/testing/logic.ts), while read_changes answered “This session holds 0 paths”. The reader cannot tell whether it must land anything before the final answer.",
    "command": "submit_work (worktree tagma-holder-impl-f0e304, commit 626ab27e91, 1 path), then read_changes without arguments",
    "expected": "The `left` list in the submit_work answer and the `held` in read_changes answer the same fact and agree"
  }
---
Filed from project `runlith`.

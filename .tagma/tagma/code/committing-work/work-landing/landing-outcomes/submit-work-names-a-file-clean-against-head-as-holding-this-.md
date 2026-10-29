---
id: 01a12ad7-e103-7b86-9dbd-7f12b512c639
title: submit_work names a file clean against HEAD as holding this session's uncommitted lines
ord: 3
tags: ["reflection"]
fields:
  {
    "actual": "landed ce9d12ab95 and named packages/execution-host/native/holder/src/holder.rs as \"lines of this session still stand uncommitted\", while git diff HEAD and git status show that file clean",
    "command": "submit_work paths=[packages/execution-host/src/ExecutionTerminal.itest.ts] in worktree tagma-holder-impl-f0e304",
    "expected": "left lists only paths where this session's lines differ from HEAD"
  }
---
Filed from project `runlith`.
---
id: 01a140a9-e43e-77e8-9750-ef5ee68c54b7
title: HolderLost closes every command, including git for committing the fix
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "submit_work refused git-not-admitted, start_terminal refused terminal-host-state: no git, shell, grep or glob runs for any agent; the only path is the operator rebuilding and restarting Tagma",
    "command": "submit_work paths=[packages/execution-host/src/holder-client/frames.ts, frames.test.ts]; start_terminal program=git commit",
    "expected": "The HolderLost cause can be committed while the host awaits restart"
  }
---
Filed from project `runlith`.

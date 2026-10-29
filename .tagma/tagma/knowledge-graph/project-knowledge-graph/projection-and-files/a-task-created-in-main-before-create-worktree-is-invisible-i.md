---
id: 01a13b17-3f45-7615-a196-cff6719ead6c
title: "A task created in main before create_worktree is invisible in the new worktree's graph: the implementer has to file a duplicate"
ord: 17
tags: ["reflection"]
fields:
  {
    "actual": "No e84adaa2 in the worktree graph (read_block/read_brief: not-found). The implementer filed duplicate 18dd8c50, and e84adaa2 in main had to be closed by hand. Two extra graph acts and one message exchange.",
    "command": "create_block #task e84adaa2 in main, then prepare_worktree/create_worktree tagma/calls-echo from main and spawn_agent in it with read_brief e84adaa2",
    "expected": "A worktree cut from main after the task's creation sees it in its graph, and the implementer picks it up via read_brief and claim_block."
  }
---
Filed from project `runlith`.

The graph in the tree apparently had not yet synced by a commit to main when create_worktree cut the branch: the task lived only in the main checkout's `.tagma` working files.

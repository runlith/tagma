---
id: 01a19584-7c83-70ae-ae41-25fc5ac3553b
title: A cross-checkout block update reports the caller’s graph instead of the block’s graph
ord: 267
tags: ["reflection"]
fields:
  {
    "actual": "The update reported the cpu-event-projection worktree graph, but a worktree search found no task and submit_work refused it as not found.",
    "command": "update_block({blockId:\"3483f789\",title:\"Keep a background tool invocation in its call span\",body:\"Keep a background tool invocation under its own span across preparation, execution and delivery, so child compaction and other collaboration calls can finish and report their outcomes.\"})",
    "expected": "Update the named task in its actual graph copy and name that checkout, or refuse if it cannot be updated there."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.

The task was created and claimed explicitly in the main checkout because its discovered-from reflection was there. A subsequent update by name reported the worktree as its graph. `read_block` found the updated task across copies, while `search_blocks({query:"3483f789",history:true})` in the worktree found none and `submit_work({tasks:["3483f789"], ...})` refused `not-found`. `finish_block` later ended that task and also reported the worktree.

The graph-operation response path is `apps/tagma/server/src/graph/operations/pairs.ts` calling `writtenAt` in `answers.ts` after `crossing.ts` runs the targeted operation in its resolved graph context. The cause of the mismatched address is not yet verified.
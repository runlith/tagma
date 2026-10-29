---
id: 01a0d56a-99b3-794b-94f8-178b760f9d28
title: "Build: finishing a worktree ends what stands in it on request"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d591-55ce-770c-bb7b-3a4c8f40dd19",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d56a-98f2-7614-833d-29a64f4df24b
  - kind: waits-on
    to: 01a0d56a-99a9-7ac1-9410-7c033624e501
---
Build [[4f4df24b]] whole. Start at `WorktreeFinishing.archive` and `endHeldExecutions`. Done when its acceptance holds and the finishing suites pass.
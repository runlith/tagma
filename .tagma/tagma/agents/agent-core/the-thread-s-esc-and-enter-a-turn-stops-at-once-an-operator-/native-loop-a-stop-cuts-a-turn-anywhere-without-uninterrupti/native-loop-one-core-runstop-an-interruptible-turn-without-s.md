---
id: 01a15f72-bede-7b69-be7c-e28b1626ca7d
title: "Native loop: one core RunStop, an interruptible turn without STOP_GRACE, a word reads before the final answer"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f72-9a81-7d49-be3a-e1dfda6272b6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d7bd56424f
---
Implementation of [[bd56424f]]: the core passes its `RunStop` into the agent loop, the runner's second stop and `AgentCalls.halted` leave; any turn wait is interruptible except the bounded write of an occurred fact; `STOP_GRACE` leaves; a word arriving during the final turn is read by that same turn. Contract tests for each acceptance case.

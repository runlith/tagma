---
id: 01a15bdd-5fb4-7221-a40e-7bdb74506236
title: Changes shows the "+ −" total of uncommitted lines and names the group project outside the thread's project
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15bc5-32cd-7a46-8153-b0c6a2a20829",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1565d-7ddd-786f-818b-357e8b0d4d88
---
The Uncommitted header carries the thread's added-and-deleted line sum, the checkout group header its own, the Changes button tooltip the common one. The sums are computed by the thread's change stream on the server from the same records it serves in the frame.

The group header names the project when at least one section group lies outside the thread's project: "billing · main". Changes only in the thread's project don't name the project: one group goes without a header, several worktrees by branch, as before.

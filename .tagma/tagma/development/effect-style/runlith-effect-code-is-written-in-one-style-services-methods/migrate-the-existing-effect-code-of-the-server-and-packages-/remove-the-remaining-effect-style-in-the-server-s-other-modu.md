---
id: 01a14c18-c833-7d88-b3bd-66ef5b12dbe8
title: Remove the remaining Effect style in the server's other modules
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c19-6c7a-788b-a8e4-4b267db89c68",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13b37-5351-7e3a-bda9-f7bf25d19486
sources:
  - kind: dir
    ref: apps/tagma/server/src
---
Bring the current Effect-style and swallowed-failures remainder in the server outside speech, threads, executions and composition to zero: first of all native-harness, platform, change-record, worktrees, providers, workspace, enforcement, checkout-files, installation, landing and the small tail. The changed owner's production and own tests go together; production graph with active latency work is not touched without a conflict check. Proof is the checker on the assigned paths with no remainder, green relevant checks and typecheck, preserved spans, a worked-through independent Sol review and commits.

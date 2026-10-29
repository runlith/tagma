---
id: 01a0ca97-13a4-7003-a128-9737b1309732
title: Write the claims of the projects a machine serves
ord: 203
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caa4-e223-796b-a967-55b24fc1e38f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/graph/projects
---
Read `graph/projects/` whole — Projects, ProjectRoots and their store, the machine registry, Sessions, WorkingOwners, holders, repo, git, ServedTree, MeasuredCheckout, blockNames, workingSet.

Write the claims of [[fe468405]]: what registering a project root establishes and what it does not, how a root that no longer exists is treated, what a session is to this graph, how the machine's own registration is read and by whom, and what the join between a graph and a working tree can honestly answer. The rule [[a00f91b0]] binds here — a retirement or reconciliation documented with a cadence must have a driver, and if one does not, that is a finding to record rather than a claim to soften.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
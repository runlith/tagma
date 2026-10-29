---
id: 01a0ca97-13d7-7dfa-ab67-405a4cf14a5a
title: Write the claims of the places work happens in
ord: 212
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0caba-e153-7b36-b5ed-4bc3c099f205",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: dir
    ref: apps/tagma/server/src/working
  - kind: dir
    ref: apps/tagma/server/src/workspaces
  - kind: dir
    ref: apps/tagma/server/src/worktrees
---
Read `working/`, `worktrees/` and `workspaces/` whole. [[3bf662bf]] already holds root-use admission — read it first and write nothing that repeats it.

Write the claims of [[6442078a]]: what registering a file root or a repository admits, what a worktree preparation leaves behind when it fails midway, what adoption and abandonment each mean for a tree somebody else may be in, what a checkout status row is measured from, and what an acquired environment guarantees for its lifetime. The rule [[a00f91b0]] binds here — the root healing and reservation acts name cadences, so check their drivers and record what you find.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
---
id: 01a0e532-cbfc-7817-83e6-7d22191594cc
title: "worktrees M2: map applied"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e9b8-65a8-70b0-bc74-beeda1d5a940",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c806-7806-be5d-983121d8b775
  - kind: waits-on
    to: 01a0e532-cbf3-72c3-a8b4-47d3266e0725
---
§7.2.2 milestone `M2` of the `worktrees` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]].

HTTP route debt (from http M2 [[dd5ad950]]): every `worktrees.*` route has an answered operation except update_worktree and read_repositories; worktrees owes those two answer schemas and moves its app and CLI callers to `/api/op`, after which the group retires into `http/retired.ts`.

Finished with divergences: `WorktreeIntents` beside `WorktreeRecords` (one `WorktreeStore` fills both, per C1); `releaseAbandonedHolds` moved by executions; `WorktreeRenames` keeps its one member `rename` as the amendment names it; operation bodies stay in composition's transitional table and the HTTP route retirement is wave-workspace's.
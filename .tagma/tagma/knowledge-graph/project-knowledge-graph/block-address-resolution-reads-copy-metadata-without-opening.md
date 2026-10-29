---
id: 01a12758-d594-72e3-841a-57eb9a75cf16
title: Block-address resolution reads copy metadata without opening each graph's full runtime
ord: 15
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1276b-5dd3-7864-8989-3fc80fe27068",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12726-9e16-7f6a-a8a2-1530ab4f67c2
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/pool.ts
---
Resolving a missing name now calls `GraphPool.resolve` and `fresh` for every registered copy; `acquire` keeps full graph contexts in the pool. Give serving a cheap identity/title read from live copies, keeping project/branch and the ambiguous-name refusal; add no cache and no release of others' contexts at the consumer. Start with `titlesAcross`, `GraphPool.acquire`, and freshness. Done: a cold lookup across several projects and worktrees keeps the same addresses and refusals, and the pool diagnostics show the metadata-only read retained no full runtime of the other copies.

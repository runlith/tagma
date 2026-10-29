---
id: 01a180d4-50fd-76fe-8d74-5d3cf13bff8d
title: A graph commit names its acts after the graph copy closed or the server restarted before it
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a180c0-b256-7a66-ba30-cf5a6fa6cb5d",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a180c0-3848-77f5-805f-e42548f545a3
  - kind: implements
    to: 01a17f5f-3c8d-78c2-b6c7-2ab1c11265c5
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/commits.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/message.ts
---
The acts a graph commit lists live only in the committers' memory (`GraphBatch` in `graph/tree/commits.ts` and `graph/serving/committer.ts`). Under `graph.commit = manual`, or when a copy is evicted or the server restarts before the batch commits, the next commit carries the dirty files with the subject `Sync graph files` and no act lines or agents. Found in review of 48f545a3. Likely direction: derive the body from the mirror journal between the last committed position (kept by the tree, e.g. in the mirror's `meta`) and the current one, filtered to team blocks for `.tagma`, so nothing about the message depends on the process that saw the acts; the batch rhythm stays as it is.
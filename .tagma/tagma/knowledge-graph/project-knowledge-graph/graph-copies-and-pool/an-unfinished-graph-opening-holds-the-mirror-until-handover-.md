---
id: 01a15244-1b93-7d8f-aab9-3f6d908223ad
title: An unfinished graph opening holds the mirror until handover to the pool
ord: 6
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1520d-63b9-715d-92db-df3621d412fb
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/pool.ts
---
Between creating the mirror runtime and publishing the pool record, observation is open. Cancelling on this boundary must close the runtime and its registration: the pool does not yet see the record and could not free its SQLite processes. So the release covers the whole stage after build, and unregister belongs to the mirror scope from the moment of registration. The store opened for moving machine rows stays with the same opening and serves the finished mirror: reopening SQLite is not needed. MirrorBuilder closes it after the mirror services, on error, and on releasing the copy.

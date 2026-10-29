---
id: 01a0e9b9-2b26-7753-a15d-996d9b6726e6
title: At restructure merge, prove the per-path reach cache's transactional recovery
ord: 151
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a0e976-db65-73a7-815f-cb29de7e92f6
---
The `restructure` build of [[de7e92f6]] exercised ordinary cache reads and writes through a worker benchmark, but this wave prohibited integration tests. At merge, write and run the bounded `enforcement/cache/store.itest.ts` cases for generation-CAS conflicts (create, advance and explicit rebuild), whole-index eviction without orphan edge/watch rows, `SQLITE_FULL` leaving the previous head intact, restart, and reach rows surviving ordinary `entry` LRU. A gate proposal made before this evidence exists names it as unproved; enabling remains outside this task.
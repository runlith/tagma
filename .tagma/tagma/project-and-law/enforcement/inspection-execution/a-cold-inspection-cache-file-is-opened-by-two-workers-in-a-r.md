---
id: 01a1205b-eb84-7eac-af15-ef0e360184df
title: "A cold inspection-cache file is opened by two workers in a race: the loser gets database is locked and judges without a cache"
ord: 3
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1205b-eb84-7eac-af15-ef0da2afe539
sources:
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/cache/store.ts
    symbol: openCache
  - kind: symbol
    ref: apps/tagma/server/src/enforcement/workers/caches.ts
    symbol: cacheAt
---
**What.** Two workers opening a not-yet-created inspection-cache file of one repository for the first time open it in a race: one gets `database is locked`, `cacheAt` writes "the inspection cache could not be opened, so inspections run without it", and that worker judges a request without a cache.

**Where seen.** Inspection-queue runs with an empty cache: the warning appeared in the first pass of almost every run. The file is one per shared git directory, so all worktrees of the repository and all queues — landing, merge, reach — open it; the server wipes the cache at start, and the race is the same there.

**Why it hurts.** A check landing in the losing worker counts as cold and saves nothing; that worker's next request tries opening the file again.

**Where to start.** `apps/tagma/server/src/enforcement/cache/store.ts` (`openCache`: `busy_timeout`, `journal_mode = WAL`, schema in `BEGIN IMMEDIATE`) and `apps/tagma/server/src/enforcement/workers/caches.ts` (`cacheAt`). Which open command gets the refusal isn't established.

**Done when.** Test: two workers open one fresh path at once — both get a working cache, no warning.

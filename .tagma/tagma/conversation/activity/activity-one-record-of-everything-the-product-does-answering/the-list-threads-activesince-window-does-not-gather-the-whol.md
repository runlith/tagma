---
id: 01a11323-2888-7706-a8fc-7240e4024638
title: The list_threads activeSince window does not gather the whole activity thread population into one array
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18896-d1d7-7a8f-9e41-11f033935b52",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1129a-5607-7dbf-8fe2-02073d2a8b42
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/list/active.ts
---
Implemented in `ade2e59fa4` and `85ee7e2474`. Ordered membership stays in the SQLite owner; the server and cursor carry a selection handle and one page. The single [[01a188a7-f28e-7f78-8703-0d68fe9ddc08|delivery review]]'s confirmed offset-rescan and eviction-during-build findings are fixed with indexed positions, custody checked in each batch's writer transaction, and partial-build cleanup. Exact-total construction still visits the population asynchronously.

Proof: the public `list_threads` regression uses three threads and one-row pages, preserves membership and order across new activity and archive, and keeps cursor size independent of matched membership. Before the fix the cursor grew from 587 to 662 bytes. Final `activityWindow.itest.ts` and `evidence.itest.ts`: 28 tests passed; the activity file completed seeds 1–3. The earlier affected `listStore.itest.ts` and `listWindow.itest.ts` checks passed 25 tests. The expanded-body envelope regression found during these checks is fixed in `ade2e59fa4`. Last server typecheck reported no changed-file diagnostics, but remained red on peers' testbed `Origin` migration and `column.e2e.ts` DOM globals.

One measurement sample: the final seed-3 public day-window request took 41.696542 ms end-to-end with three threads, three activities and limit 1 in the in-process test fixture. This includes waits; it is neither a main-loop profile nor a production/large-population latency claim.

This focused delivery does not establish the enclosing spec's outstanding post-restart native/ACP/terminal, recap and interruption live check, or its repeated independent nine-axis rating of at least 9 on each axis. The earlier intermittent fixture-teardown hang remains unestablished in [[5186ea95]] despite subsequent green runs.

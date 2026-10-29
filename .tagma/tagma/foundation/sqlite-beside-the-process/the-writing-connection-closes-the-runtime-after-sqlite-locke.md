---
id: 01a131f9-1a04-7cf7-ab30-68f847835745
title: The writing connection closes the runtime after SQLITE_LOCKED during the archive bench
ord: 14
tags: ["reflection"]
fields:
  {
    "actual": "After 6 s runtime called process.exit(1): [tagma] the store ... is gone: database table is locked; the statement and the original failure lost.",
    "command": "bun src/composition/testing/threads/threadArchive.bench.ts --rounds=3 (apps/tagma/server)",
    "expected": "Tagma's own runtime archives a tree of 26 threads over 300000 historical commands and answers with a measurement or a typed failure with the statement."
  }
---
Filed from project `runlith`.

The stand runs in its own temporary root; the working server untouched. After printing EXPLAIN command_owner_idx, two writer hold-thresholds of 250 ms, then fatal onLost from platform/store/open.ts. Fixture without execution host, command_wait empty; the SQLITE_LOCKED origin undetermined.

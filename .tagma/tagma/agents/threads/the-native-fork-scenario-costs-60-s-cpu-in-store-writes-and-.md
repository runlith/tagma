---
id: 01a1a5fc-8316-7d37-9f7c-f5c01ea84c92
title: The native fork scenario costs ~60 s CPU in store writes and crosses the test guard on a loaded runner
ord: 161
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a5df-8d95-74d4-a1cd-79467ef2e8f4",
    "status": "in_work"
  }
---
`forkNotice.itest.ts` › "native forks preserve request bytes across birth doors, history cuts and compaction" is one scenario of ~14 scripted turns, 4 spawns, 3 branches and a compaction. It does not hang: CI run 41766802714 spent 66.6 s CPU over 172.7 s body wall and was cut by the 180 s guard (run 41763572270 passed at 55.8 s CPU / 132 s); locally under `taskpolicy -c background` it measured 59.6 s body CPU and failed at the guard once, passed at 136 s once. The "project 2 was not removed: null" line is the leave finalizer's `remove_project` being answered 503 after the guard interrupted the test.

Measured on one slowed local run (one sample): ~68% of worker CPU is in-process SQLite (`packages/sqlite-process/src/inline.ts` drain), spread over ~1,300 write units (COMMIT alone 6.6 s exec over 1,281 commits) and ~600 `thread_record_facts` journal-place reads, with no single hot statement. Every act carries an assertion, so cutting the scenario drops cover.

Cut the per-turn store cost at its owners (write units per native turn and spawn, repeated journal-place and thread-row reads) until the scenario sits well under the guard on a 3-core runner; profile with `.agents/skills/tests/scripts/profile.ts` and the pool's statement census.

---
id: 01a14041-5389-7b0a-9226-5e6eeeb8d7a5
title: "After restart each thread's first run re-hashes history: message digest and price are not stored with it"
ord: 32
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1401c-e794-71da-b777-0ef664f8bca0
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/transcript/history.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
---
The message price and digest cache, moved out to `ThreadCompactor` (task 64f8bca0), lives by object identity, i.e. only inside the process. After a restart history objects are new, and the first run of every resumed thread serializes and hashes the whole history again: ~15 ms CPU per MB, on the main thread. That is a `bun -e` sample in packages/agent. Resumed threads pay it all at once.

Direction: a message's digest and price are computed at write time into `thread_history_item` and stored alongside (ADD COLUMN nullable per rule d81b1676), read at history load, and the meter takes them without hashing. A message whose columns are empty (written before the change) is hashed as today. The record owner is native-harness/transcript/history.ts, the digest-form owner is ThreadRequestMeter.

Proof: a test — after history is written, read by a new store, and `requestHashed` over it never reads message `content` (counter), and its answer equals the answer over a hashed copy.

## Outcome

Done in `b4d9e0a879`. Test in `history.itest.ts`: history is written, read by a new store, and `requestHashed` over it never reads message `content` (counter), and its answer equals the answer over a hashed copy. Measurement is in [[b5059c61]]: the first step after restart on 10,000 messages costs 21–27 ms CPU instead of ~430 ms.

Not proven and left over:
- a message price with a picture is not stored (depends on `imageTokens`) and is recomputed;
- rows written before the migration, and rows a form step mutates at load, hash as before; only the next row rewrite fills their columns;
- a live server restart with real threads was not checked.

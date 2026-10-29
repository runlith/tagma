---
id: 01a14bc0-767b-73c0-89c8-7ffb0a4dca9c
title: Journals of idle threads leave the database and are read from rollout files
ord: 8
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-9288c2f9fd4b
  - kind: relates
    to: 01a14bc0-7671-7bdb-92a9-e696a4e069a4
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/evidence/threadEvidence.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rest.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutEviction.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutShelf.ts
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: idleProjectionDays
---
**Value.** The server database does not grow with every old thread: entries of a long-untouched thread live in its file and return when the thread is needed again.

**How.** By itself; idle time is the `threads.idleProjectionDays` setting, zero turns unloading off. Archiving queues the thread at once.

**Behaviour.** Every thread writes entries both to the database and to its own append-only rollout file. A thread idle past the limit is unloaded by a background queue: entries leave the database, feed and readings work from the file. Reading the context composition and the compaction menu keeps the unloaded state, including accounting of earlier compactions and cleaned tool outputs. The first door that needs a live entry — send, steer, continue — returns the thread to the database.

**Limits.** A thread is not unloaded while a run goes in its subtree, while it is in use, or while its file lags the database. Unloading drops scratch and saved full tool answers.

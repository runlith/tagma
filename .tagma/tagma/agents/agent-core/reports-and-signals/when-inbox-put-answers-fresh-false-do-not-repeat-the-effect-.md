---
id: 01a0c980-603e-79da-9cc6-524bcc4c36c8
title: "When `inbox.put` answers `fresh: false`, do not repeat the effect of the put"
ord: 2
tags: ["rule"]
sources:
  - kind: dir
    ref: packages/agent/src/thread/storage
  - kind: file
    ref: packages/agent/src/thread/ThreadPorts.ts
  - kind: file
    ref: packages/agent/src/thread/ThreadStepObserver.ts
  - kind: symbol
    ref: packages/agent/src/thread/storage/inbox.ts
    symbol: ThreadInboxStorage
---
The item was already stored by an earlier attempt; the caller replays its answer only.
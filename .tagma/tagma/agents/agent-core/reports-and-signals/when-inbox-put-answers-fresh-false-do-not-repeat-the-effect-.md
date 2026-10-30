---
id: 01a0c980-603e-79da-9cc6-524bcc4c36c8
title: "When `inbox.put` answers `fresh: false`, do not repeat the effect of the put"
ord: 2
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/agent/src/thread/storage/inbox.ts
    symbol: ThreadInboxStorage
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/inputs.ts
---
The item was already stored by an earlier attempt; the caller replays its answer only.
---
id: 01a14c05-9e8f-7c75-a633-b2b3dd761187
title: An agent sees the server's file watchers and sources of frequent rescans
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
sources:
  - kind: file
    ref: apps/tagma/server/src/performance/contract/wire/operations.ts
  - kind: file
    ref: apps/tagma/server/src/performance/operations.ts
  - kind: symbol
    ref: apps/tagma/server/src/platform/watch/tree.ts
    symbol: watchReading
---
**Value.** An agent finds the file watchers that wake the server most often or make it rescan the tree.

**How.** `read_watches`.

**Behaviour.** The reading shows open and temporarily parked places, recursion, events and rescans, starting from the most active. A parked place holds no subscription while Tagma itself changes the tree. Resets of a place's own subscription count among its rescans.

**Limits.** These are the current server's places: events and rescans count from each place's opening. This is not the machine's system watcher list and not a kept history. Diagnostics neither change watches nor fix the rescan cause.

---
id: 01a145f2-c8f8-71e3-949c-4666ce9b0fcf
title: "Tree refreshes never wait under the machine base writer or the same tree's mirror writer: settled refuses WaitUnderHold"
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a0cacc-8c1e-71ee-b3ef-a5351e4a8f0d
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/freshness.ts
---
`FreshnessGate.settled` dies with `WaitUnderHold` when the caller stands inside a machine-base or same-tree-mirror unit. The check fires before any waiting and never depends on whether the tree is fresh. So the violation shows in the very first test, not only once the tree goes stale.

Every machine write holds the machine base writer. Waiting out a refresh under it means stopping the machine for the whole refresh — and while refresh read the registry through the writer, the wait was eternal. Refresh needs the mirror writer itself: it writes what it read from the tree into the mirror.

Another tree's mirror writer never blocks the wait. An act that opens another graph inside its own transaction lawfully waits for that graph's first refresh.

This is the mechanical side of the [[1e4a8f0d|settle-before-opening-a-unit law]]. `held` never sees writer holding inside a transaction, so the check reads the store's open units (`UnitWrites`).

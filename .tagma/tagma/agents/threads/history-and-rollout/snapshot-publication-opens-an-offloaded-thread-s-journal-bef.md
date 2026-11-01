---
id: 01a14f46-9f50-76fd-9731-dfc2a92c2538
title: Snapshot publication opens an offloaded thread's journal before the snapshot lock, and offload and rollout forming take uses.rest only inside the journal lock
ord: 10
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a14f3e-a5c6-7cc7-afbe-7f4b297b18ea
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/engine.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadSnapshots.ts
---
A whole publication reads its journal under `atCut`. Opening a compressed offloaded rollout or settling an interrupted file publication may enter the thread journal lane, so residence prepares that source before `atCut` and holds its use until the read finishes. Offload and background forming refuse an in-use source; otherwise they could change the file during that read.

Order is fixed: first the thread journal lock, then `uses.rest` (`evict`, `rolloutWhole`). Publication is also asked from inside the same thread's journal steps (`afterCommit`, `ensuring`); the step then awaits the drain, and the drain's `using` awaits any running `rest`. When `rest` is taken outside the journal lock, `rest` awaits the lane held by the publishing step, the step awaits the drain, and the drain awaits `rest`. Only the lane's minute ceiling lifts this mutual wait.

The drain fiber holds no lane of the caller's, so publishing an offloaded thread from inside another thread's journal step enters that thread's lane as an ordinary wait instead of refusing `WaitUnderHold`.

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
`ThreadSnapshots.publish` reads the journal while holding `agent-snapshot-lane`. Under a held `Lane.enter` into `thread-journal`, `WaitUnderHold` dies, and reading a compressed rollout of an offloaded thread, or one whose publication a crash left unsettled (`RolloutForms.readable`), enters that lane to open or settle it. So publication runs inside `ThreadResidence.reading`: the server opens the rollout (`RestedRollouts.readable`) before the snapshot lock and holds `rollouts.using` until publication ends. Offload (compresses the file) and forming (drops the form mark and rewrites the file) answer `in-use` and wait for the next access.

Order is fixed: first the thread journal lock, then `uses.rest` (`evict`, `rolloutWhole`). Publication is also called from inside the same thread's journal steps (`afterCommit`, `ensuring`), and its `using` awaits the running `rest`. When `rest` is taken outside the journal lock, `rest` awaits the lane held by the publishing step, and the step awaits `rest`. Only the lane's minute ceiling lifts this mutual wait.

Limitation: publishing an offloaded thread whose rollout is not yet open, from inside another thread's journal step, still refuses `WaitUnderHold`.

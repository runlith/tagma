---
id: 01a0c969-92c1-784e-a46e-e13575270b80
title: The openGroup twin of the removed guard still drops a group opened while the store is unavailable, so its records are unprotected after recovery
ord: 38
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0c943-a623-7a28-8565-9ad22033ae3f",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c85e-a27b-766b-ad10-f5740e125143
---
Found reviewing [[0e125143]]'s fix (`9053b1ba9d`), which removed the `if (state === 'unavailable') return;` guard from `closeGroup` in `packages/performance/src/PerformanceStore.ts`.

The same guard still stands at the top of `openGroup`, three lines above it. A group opened while the store is unavailable is therefore never recorded: after recovery its records are unprotected, and when its producer closes, the close is a no-op because no depth was ever taken. The argument that closed `closeGroup` — the two structures are main-thread bookkeeping and no worker round-trip is involved — applies verbatim to `openGroup`, so the asymmetry is not a protection.

Unreachable today: `PerformanceTracer.submitTrace` is the only production caller and it is synchronous. It is the store's public contract all the same (exported through `index.ts`), and the imbalance is visible in `diagnostics().activeGroups`.

Fix at the owner: `openGroup` records the group whatever state the worker is in, exactly as `closeGroup` now releases it. A test opens a group while the worker is gone, brings one back, submits records under that key and asserts they are protected and the ring's floor counts them.
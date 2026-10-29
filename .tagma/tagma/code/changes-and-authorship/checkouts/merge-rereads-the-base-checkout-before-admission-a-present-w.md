---
id: 01a14ce5-cb23-76a3-83df-dde067a4bcb0
title: "Merge rereads the base checkout before admission: a present watcher does not prove delivery of the last write"
ord: 19
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/landing/merge/integrate.ts
    symbol: integrate
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
    symbol: makeGitCheckoutRows
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/service/checkouts.ts
    symbol: CheckoutRows
---
The checkout's observed line reflects the last completed read, and the file event arrives later than the write itself. `CheckoutRows.refresh` takes the next reread number and invalidates the shared tree snapshot in one synchronous step, then waits for that completion even with a live watcher; completion is counted separately from a revision change. Its success carries that read's result, and a git failure is kept in the error channel; the observed line stays available with a stale mark on that same failure. Merge requests such a snapshot inside the base lane before checking staged and held paths. The snapshot belongs to the new read; later external writes stay new changes.

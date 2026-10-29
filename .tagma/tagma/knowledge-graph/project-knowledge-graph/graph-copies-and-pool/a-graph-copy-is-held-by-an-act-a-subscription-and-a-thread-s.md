---
id: 01a16a45-7fc1-7190-a65a-1e79be0e9b8f
title: A graph copy is held by an act, a subscription, and a thread's running run; with no holdings the pool closes it after T, and past the idle budget immediately the stalest
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/threadCopies.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/copies.ts
    symbol: keepingOf
  - kind: symbol
    ref: apps/tagma/server/src/invocation/admission/services.ts
    symbol: carrying
---
Holding is not a lock: only the pool closes a copy, and neither budget nor T touches a held copy. An act holds its call's copy for the whole execution (carry in invocation), the graph feed for the subscription duration, a thread's run while the thread has a run going: the composition holder takes the thread roots' copies and picks up ones that open later. `resolve` without holding only marks use. Project removal, storage moves, project root changes, and worktree deletion close a copy regardless of holdings.

An idle copy closes T after last use, and if idles exceed the budget, the longest-unused closes at once: a human walking 30 worktrees in a minute never holds 30 copies for T minutes. The budget never closes a held copy — or a long act (merge, landing) would lose the graph mid-work.

`keepingOf` derives T and the budget from the machine. The budget is a quarter of server memory per 256 MiB copy envelope; the envelope is an estimate, not a measurement. T is 30 s per budget slot, adjusted for cores (weaker CPU means holding longer, since reopening costs more), within 1 to 10 minutes. On 12 cores and 32 GB that yields 16 copies and about 5.3 min. Reopening an adopted copy is a cold read by the watcher mark, not a rebuild.

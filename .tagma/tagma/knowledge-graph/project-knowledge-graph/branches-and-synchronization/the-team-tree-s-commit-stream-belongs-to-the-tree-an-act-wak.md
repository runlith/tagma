---
id: 01a10e4a-9107-74f0-98e5-a576ed330a7f
title: "The team tree's commit stream belongs to the tree: an act wakes it after commit or a non-act write, and it runs in the opening's runtime"
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/advance.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/commits.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/batch.ts
    symbol: publishToCheckout
  - kind: symbol
    ref: apps/tagma/server/src/worktrees/retirement/delete.ts
    symbol: WorktreeDeletion
---
Under `graph.commit = auto` the team tree commits the graph itself: everything changed under `.tagma` leaves as one graph commit after a pause in writes, worded by the one graph commit assembler and signed `Tagma <agent@tagma.dev>`. The loop doing it belongs to the tree, not to whoever woke it. If the branch has no commits yet, the automatic write and `sync_graph` create the root commit from the graph only; someone else's staged code stays in the index.

- **The loop starts from a runtime obtained at the tree's opening** (`FiberSet.makeRuntime` in its scope). Started from the waking act's context, it inherits the `UnitLife` of an already closed unit, and its first statement to the graph store dies with `LateStatementRefused`: every batch is lost.
- **An act wakes the loop after its own commit**, like a landing (`writeThrough`), not from inside a unit: a rolled-back act wakes nothing.
- **Opening a team tree and moving project storage wake the checkout's loop** (`carry`), as do passed format steps and the `format.json` marker. Opening recovers changes already laid into the checkout, even when no graph act follows. A move to stealth uses the new copy's runtime to commit the removed team files; closing the old copy must not discard that checkout work. This removal carries no graph journal: later stealth acts and their journal position belong solely to the own-git tree, even while its publication is held. These batches obey `graph.commit` and the same unfinished-operation checks as graph acts.
- **A round's failure or defect is logged and retried with backoff.** A loop that died without a log leaves graphs uncommitted with no trace of it.
- **A settlement torn down with no decision is the tree's debt.** If `settleIndex` failed (someone else's `index.lock`, a git failure) or HEAD moved under it, the commit's writes stay the tree's debt; the commit itself wakes the next round, which first repays the debt to the same `settleIndex` with its checks — branch, blob in HEAD, index equal to the base or the published blob. Paths settlement deliberately left (hand-staged) never become debt. Without this a block born under someone else's lock stood in the index as `D` + `??` for hours: later rounds asked settlement only about their own delta. The debt lives in process memory; a restart loses it.

Deleting a worktree before reading the leftovers hands the graph to the same commit as `sync_graph`, then releases the found copy in any outcome so the graph never writes into the folder again. Delivery uses an already held copy or opens a cold one if a targeted `git status` of its graph files shows uncommitted changes: an earlier server or `graph.commit = off` could have left them. A clean cold copy never opens. The same copy-picking rule applies when creating a worktree from the base and before merging. A commit refusal never stops the deletion: the remaining dirty graph files leave in the leftovers commit with the rest.

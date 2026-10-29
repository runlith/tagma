---
id: 01a14c13-c481-7acc-8aa6-03ccace11ae4
title: A merge blocked on a busy base checkout waits in queue and lands on its own when the base frees up
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/src/landing/queue
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/FinishStrip.svelte
  - kind: file
    ref: apps/tagma/server/src/landing/store/pendingMerges.ts
---
**Value.** The operator doesn't need to catch the moment when nobody holds lines in the main checkout and no operation runs: the merge will wait for it on its own.

**How.** The merge dialog sets the wait itself when it sees the base busy; the agent — `merge_worktree` with `whenBaseFree`; Stop in the completion strip and the row menu — `cancel_worktree_merge`.

**Behaviour.**
- Only a merge refused for base busyness queues: other holders' lines, staged, an operation in progress, a lost race for the tip.
- The server retries it on every base checkout or branch movement and periodically, across restarts, until it lands or meets another refusal.
- A stalled merge stands on the worktree row with a cause and repeats when what the refusal rested on changes, even without tip movement; Dismiss removes it by hand.
- Waiting holds the caller and spends their authority when the merge lands; merging or deleting the worktree removes the wait.

**Limits.** A queued merge's landed answer warnings don't reach the one who queued ([[d643a7b9|the lost-warnings task]]).

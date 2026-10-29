---
id: 01a1365f-aa4f-7686-b9dc-569dcd383129
title: Merge recovery with deletion after it reconciles the interrupted deletion against the worktree record instead of answering 'unknown'
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a13620-124c-75b1-8c9b-9ccc2dbd69ab
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/merge/tail.ts
---
If the server fell during deletion after a merge (`after: delete`), the merge tail on recovery sees `afterState = running` and writes `refused` into the receipt ("unknown whether it finished"; `landing/merge/tail.ts` `afterAct`). Independently of that, `WorktreeDeletion.recover` completes an open deletion intent, and an intent in the `intended`/`ending` phase closes without deleting. So a merge receipt can claim refusal forever when the worktree is already gone, or a deletion can stay abandoned.

To do: on recovery the tail reconciles with the world — no worktree record and no deletion intent means `done`; a standing record with no intent restarts deletion. Either the `deletion.recover` and `merges.recover` startup order must be fixed, or the reconciliation must be made independent of it.

Done when a merge-recovery test with deletion, interrupted in each phase, reports the true outcome in the receipt.

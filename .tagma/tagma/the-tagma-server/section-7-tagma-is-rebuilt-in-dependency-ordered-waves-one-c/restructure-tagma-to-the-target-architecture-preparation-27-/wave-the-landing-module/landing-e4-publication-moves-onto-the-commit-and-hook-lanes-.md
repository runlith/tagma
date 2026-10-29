---
id: 01a0eb2b-f2a7-78b1-8596-e1589d54626b
title: "landing E4: publication moves onto the commit and hook lanes, and the landing, preservation and merge-queue semaphores go"
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e533-8064-7d5a-81fb-ef815c9f98b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e2a3-49a3-7e17-b24c-0979511b13e3
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/gate.ts
  - kind: file
    ref: apps/tagma/server/src/landing/preservation/commit.ts
  - kind: file
    ref: apps/tagma/server/src/landing/queue/pendingMerges.ts
---
Carry section 3's landing protocol ([[511b13e3]], E4) into `landing/`, the part the landing wave left standing.

What stands now:
- `landing/land/gate.ts#gateOf` holds one `Semaphore` per checkout root across the whole landing: build, judgement, `git commit` with the user's hooks and the shared-index sync.
- `landing/preservation/commit.ts#preservation` serializes each archive key with a `Semaphore` map around work that enters the platform commit lane.
- `landing/queue/pendingMerges.ts#MergeQueueDriver` holds one `Semaphore` per worktree root through a whole merge, including its archive or delete.

None of the three can become an `@runlith/held` hold as they are: each waits on a lane (`platform/git/lanes.ts` refuses to be entered under a hold with `WaitUnderHold`) or on a git process with the user's hooks, so they stand as `held-resources` debt owned by this task.

Target, per E4: a landing is a compare-and-set of the judged base (`commit-tree` then `update-ref <ref> <new> <base>` through the commit lane, rank 290), with its hooks on the hook lane (rank 280), so the per-root gate goes; the merge queue's pending gate (rank 110) covers only a short claim of the row, and a merge try-admits the finishing gates instead of waiting; the preservation key serializes on its intent row, never on an in-process map.

Built in 869ad2bf87, 3855ed27dd, 4b9315fa89 and 9031246944. It diverges from E4 in four places, each chosen so that what a user sees does not change beyond fewer busy refusals:
- A merge waits on the finishing sections instead of try-admitting them.
- The landing commit carries no `Tagma-Landing` trailer; the reflog entry `tagma landing <job>` is its receipt.
- A hook on git older than 2.36 answers submit_work `refused` in git's words instead of a `git-too-old` code.
- Hooks run only where the checkout has one.

Done when the three `held-resources` entries naming these files are gone because the semaphores are, `submit_work` still judges the prepared change before publication with the verdict `check_rules --over change` gives, and a landing killed after publication is still answered at boot by its intent key.

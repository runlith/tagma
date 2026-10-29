---
id: 01a16e60-0e2e-74ee-b1af-1336a33b3398
title: "Landing judges the selection's paths once: the carriers selection judgement reaches the tree build while fresh"
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dfb-d3b1-7a0c-8a44-11413b9da093",
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a16e4a-4793-72ac-b7a5-84fa83fcc59c
sources:
  - kind: dir
    ref: apps/tagma/server/src/change-record/prepared
---
Review [[83fcc59c]] found that `submit_work` judges the same paths twice: at carrier selection (`prepared/carriers.ts`) and again at tree build (`prepared/tree.ts`). The selection judgement needs to reach the tree and reset at the command's settlement and on reselection (`prepared/change.ts`). If the passed judgement's freshness cannot be proven, the task closes with the reason and nothing lands. Measurement — an A/B git-site preload on one HEAD.

**Closed without landing: the passed judgement's freshness cannot be proven cheaper than the judgement itself.** Each `judged` Holdings judgement lays paths into `now` and runs the batch with a fresh probe (status, stat, write-record rows), so the second judgement is that fresh read. What the judgement stands on changes between the two judgements:
- `reads.commands.settled` (`prepared/change.ts`) waits for other commands' row writes on the selection paths. The loop exits without reselection when the carriers' `decided` revision never moved, so the selection judgement may be older than the rows just waited for.
- `heldOf` (`prepared/tree.ts`) reads the write-record rows after the judgement. A path the judgement called undivided lands whole with the `ids` of all its rows. A peer row that appeared after the judgement would land in the commit with no holder name in `carried`.
- For paths that land whole there is no digest check: only `cutOf` makes one. A peer write through the tool during `peerMerge`, `mergeFor`, or `locateIndex` would never see the selection judgement.

Proving nothing moved takes the same probe — the very batch meant to go. Watcher events are asynchronous and prove nothing. The gain would be no more than one batch per submit (one `status`, occasionally `check-ignore`).

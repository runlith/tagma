---
id: 01a14a75-20f3-7f7d-bba9-0bd3d643a7b9
title: "A merge landed from the queue loses the answer's warnings: yielded, watched, unjudged, unsynced, and edited never reach the requester"
ord: 4
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14a51-5263-77e3-bd28-be14861b4790
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/queue/pendingMerges.ts
---
`merge_worktree` with `whenBaseFree` answers `queued`, and the merge that later lands from the queue (`makeMergeQueue` in `landing/queue/pendingMerges.ts`) drops its `WorktreeMerged` answer: its `yielded` (graph files where the branch's change yielded to the base, [[bf0acea1]]), `watched`, `unjudged`, `unsynced`, and `edited` reach nobody. The receipt (`MergeReceipt`, the `merge_receipt` table) and the thread feed entry (`WorktreeEntry` in `threads/mergeNotice.ts`) do not carry them.

Do: warnings of a queue-landed merge reach its requester and the worktree's threads — through the receipt and the `merged` entry or through the worktree line, by the landing owner's device.

Proof: a merge queued on a busy base and landed later with a yielded graph file names that file where its requester will read it.

---
id: 01a132b7-5d62-766a-aceb-e338e97fcd17
title: A shared ref movement starts a full git status in every worktree
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1321c-625d-7dd4-9e15-215c3aba4bb1",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1321c-2265-787f-bcd0-daa6156f2211
sources:
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
---
After the restart at 8f00db9219, checkout status reads still run ~1 a second (244 over 4 minutes on 13.10 ~00:40, 323 ms average, slow ones 1.5–1.8 s), git processes ~10 a second. The false `config`/`ignore` are gone; now most slow reads are marked `checkout.reason: refs`.

Refs are shared by every worktree of a repository: each commit, fetch, or branch move by any agent marks `refs` on every open checkout, and each does a full `git status --untracked=all` plus two `numstat`s. A ref movement does not change that checkout's working tree or index: only branch/upstream, ahead/behind, and the base comparison depend on it.

To do: a `refs` mark (and `head`, if the checkout's own HEAD did not move) rereads only what depends on the ref — branch, ahead/behind, comparison — and reuses the previous tree read; the full read stays for `tree`/`index`/nameless rescans. Verify the line read stays consistent (HEAD moved → full).

Verified red/green: someone else's ref updates metadata with no `git status`; its own HEAD/branch and an unknown rescan read the tree whole, a failed refresh recovers with a full read. In its own built `tagma:try` (4 checkouts, 200 tracked files, 12 new commits/ref updates over ~9.8 s, sampling=1) `Git.spawn` went 552→408, all `Git.status` 72→24, of them checkout-tree 48→12; `CheckoutStatus.reading` stayed 48, but the 36 foreign ones are now metadata-only. A raw git-status oracle confirmed four HEADs, ahead/behind, and area preservation. Before: e5c03f441f-dirty 20261013T004720955Z, instance 605c989a-0f9a-46b7-a187-ce114fbd9450, [1791853066403,1791853076264); after: 95fc9dd754-dirty 20261013T013650112Z, instance de1aeb09-c987-45bc-8f8c-bc4859c5f6fe, [1791855508373,1791855518115). That is one sample, and latency under concurrent load does not prove CPU speed. Retained spans keep checkout.root/path. Sol and two Muse lenses read the delivery; the confirmed finding of a false onMark for metadata is fixed at the producer, and the public contract checks for no tree-input notification and a single notification on HEAD for two bases. Integration files are split by subject and pass with no CPU warning; the last typecheck is clean on 4574 files. The running server was untouched. No independent measurement of the win on active non-empty Holdings was taken; its invalidation is covered by the onMark contract.

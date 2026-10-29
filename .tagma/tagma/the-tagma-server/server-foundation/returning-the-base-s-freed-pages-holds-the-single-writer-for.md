---
id: 01a13639-5ab7-793d-a23b-1cf699798b81
title: "Returning the base's freed pages holds the single writer for tens of seconds: journals, publications and thread opens queue behind it"
ord: 13
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13629-3dec-7e8e-86c0-8feaf668f228",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/vacuum.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rest.ts
---
Returning the base's freed pages holds its single writer for tens of seconds, and everything that writes queues behind it. Measured 2026-10-13, server pid 64146:

- From 16:43:47 to 16:46:50 UTC the server ran `PRAGMA incremental_vacuum(N)` back to back with N from 1,528 to 23,915 pages, each 5–25+ s (serve.log: "a statement has been running"). At night at 00:37 UTC `incremental_vacuum(80103)` ran over 85 s. Two other instructions over 5 s on this server that day.
- Over an hour `Store.permit.wait` shows 53,863 writer waits for 1,689 s, 30 of them 16–33 s. A thread-journal write (`ThreadStore.kernel`) waited on the writer for 21.9 s exactly under an `incremental_vacuum(7040)`; it waited under the thread's cut (`ThreadLiveFeed.atCut`), so state publication (`ThreadSnapshots.publish`, 10.4 s) and thread opening queued behind it. The client shows "This thread could not be read" after 10 s with no opening frame.
- A page's cost grows with freelist size: in an 18.75 GB base 2,430,927 pages (~10 GB) are free. A synthetic sample: `incremental_vacuum(5000)` with an 11k freelist — 0.11 s, with 210k — 0.84 s.

Vacuum is called by four places identically: measure the freelist before, delete rows, return the difference in one instruction — thread-journal offload (`threads/journal/rest.ts`, inside the thread journal's lane and `uses.rest`, so reading that thread also waits out the whole vacuum) and the `bounding`, `footprintFolding`, `stripping` passes.

What to do: the store owner returns freed pages, not each deleter. The deleter hands the store its freed-page count and does not wait; the store returns them in portions with its own fiber, each portion holding the writer no longer than a portion, with a pause between portions, outside any domain lane.

Proof: returning N pages never holds the writer longer than a portion (a store itest), the deleter does not wait on the return, the pages still return; on a live base after delivery serve.log shows no `incremental_vacuum` over 5 s.

Delivery `37e5ffa72f`: `Store.reclaim` and the store fiber in `platform/store/vacuum.ts`, the four deleters only report freed pages. `vacuum.itest.ts` — given pages return, the freelist empties. A narrow measurement on a synthetic base (115k-page freelist, sample): one 5000-page instruction held the writer for 3.49 s, `reclaim(5000)` — at most 161 ms of writer wait with 193 writes through. Review (Sol xhigh and two Muse lenses: races, performance), confirmed fixes in `f495eada5f`: freed accounting moved to the store (`Store.freeing`) — the caller's freelist delta lost pages under a parallel return; the step starts at one page per pass and clamps to the freelist inside the portion — no-op instructions no longer accelerate the step; the pause counts holding with COMMIT. Itest: the writer passes while the return runs, and pages freed during the return return too. Not proven: behaviour on a live base — it comes after the operator restarts the server.

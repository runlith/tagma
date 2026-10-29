---
id: 01a1514e-e2d9-7703-a3d7-675a97350375
title: read_amendments counts conflicts across all open proposals on every page
ord: 80
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1515e-458e-71da-ac11-4a0e75315bf9",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15122-5336-7088-b725-b4f063ea1699
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/work/proposals/listing.ts
---
Since the [[63ea1699|move to keyset]], a `read_amendments` page reads only `limit + 1` proposals from the store, but `Review.conflicts` (`graph/work/proposals/listing.ts`) re-selects all open proposals on every page, parses their ops and target bodies, and compares every pair — O(n²) over open proposals — while the answer needs only the total `totalConflicts` count and the fights of the page's rows. Start with how to get `totalConflicts` without recomputing on every page (an owner projection or another answer shape — the task's decision) and fights only for the page's rows. Proof is an unchanged `read_amendments` answer (`graphQueuePages.itest.ts`) and conflict reads that do not grow with the page count.

Result: Review holds a projection over the graph revision; the large index and its pages stay in the worker, a unit walks the stored answer and the external-read queue. `Sources.byBlock` reads ids in statement pages. Verified with `bun run typecheck` (5099 files), `listing.itest.ts`, and `graphQueuePages.itest.ts` (9 tests): the operation's answer is unchanged, zero SQL on later pages of the local and worker projections, invalidation, rollback, and sources reads for 32767 ids. The independent Sol review was taken apart; confirmed findings are fixed. Local compute-only sample: 1000 amendments, 10 pages of one each — the old full recompute 287.59 ms, index 2.09 ms and pages 3.26 ms; totals 499500 and 9990 reported fights match. Live-server latency was not measured; the operator's server was not restarted.

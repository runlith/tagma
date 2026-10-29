---
id: 01a15134-0b9f-7e2c-809e-ec1a0f5e8829
title: The page shelf walks the whole selection and serves the index synchronously on the server loop
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15136-49a0-7409-b8c5-b9da32152a97",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d727-72aa-b665-acc0f13fcc59
sources:
  - kind: dir
    ref: apps/tagma/server/src/artifacts
---
In `apps/tagma/server/src/artifacts/shelf.ts:178–180,203–230,333–442` the full shelf selection, pages/follow, rebuild, and compaction ran a growing synchronous file pass on the server loop. HTTP `composition/http/artifacts.ts:41` called store.list() with no limit: whole-shelf manifests were read; live follow read and sorted the whole team page set before slicing. The page count was bounded by no response size; `installation/closure/versions.ts` helpers worked on the server in these same chains. Reading one HTML separately was never declared a defect. The risk of stalling the remaining requests stood as code, with no measured actual lag.

The shelf moved to one scoped worker: files, journal order, sidecars, current, restore, and compaction change under one owner; the main loop gets only the requested slice or one HTML. The full list overload is gone. The browser index serves 50 rows with a snapshot cursor and a continuation link. A team keeps the exact total and the first-requested ownership of a shared page; top-k is picked in O(n log limit), republication from the same thread never re-reads the whole claims file. Between calls only the last publishing thread's claims are held, not every once-requested id. File shapes and durable record order are kept. The owner contract is the [[04a58d61|worker-shelf note]].

Public storage and HTTP operations covered: 16 integration tests and 8 order unit tests pass. Snapshot/stale, damaged-index restore, retention and compaction, including its refusal after a finished publication, team top-k, live follow, and HTTP paging are covered. A worker-death fault injection first found a re-entry bug in the loss handler: an awaited call's continuation added a new request to a Map still being walked. Waiters are now extracted and cleared before callbacks; the test passes through refusing the current read and restoring the page on the next call. One [[01a15144-f873-785e-b7e1-5c47c1693217|independent review of the whole shelf and commit-queue delivery]] parsed; local remarks on diagnostics, types, and claims holding fixed. Law checks found no violations. The last `bun run typecheck` exited 1: four TS2769 in someone else's `packages/agent-tools/src/preparedSubjects.itest.ts:307–310` and four TS18047 in someone else's `graph/serving/advance.itest.ts:37,74,123,126`; touched files got no diagnostics.

One standalone sample on a synthetic 1500-page shelf: cold index restore took 2517 ms, a team selection 412 ms; the calling loop ran 1533 heartbeats in that time, the largest observed interval 104 ms. This is a sample of a shared checkout under parallel load, not a live-server measurement, not p99, and no guarantee of an interval under 50 ms. The probe is not kept as a benchmark. The working server never restarted; live-process lags and power-loss shutdown were never verified. The remaining repeated file pass of active live selections after this delivery was removed in the [[0929e6f9|subscriptions task]]: an incremental projection shared between readers and freed after the last release.

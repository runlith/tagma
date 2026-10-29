---
id: 01a15026-7d1d-7ee3-9eb9-3c8ac7ca1b5f
title: The lines-held refusal names every path with foreign lines at once, not the first one found
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14a05-5a4d-76a0-b1af-97cb761579da",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15018-9312-7d2f-8f3c-56cf0e9e270d
sources:
  - kind: file
    ref: apps/tagma/server/src/change-record/prepared/tree.ts
---
`prepared.build` planned paths through `Effect.forEach` with the first failure, so `submit_work` refused one path per call: the refactor-bridge needed eight attempts to find a landable subset. Now the plan collects every path's refusal, and one refusal (`lines-held` where foreign lines are among them, `walk-cut` otherwise) lists every path with its reason; the first unblock is landing without all of them, with move pairs.

Proof: an itest in `landing/submitPeers.itest.ts` (two paths with foreign lines — one refusal names both).

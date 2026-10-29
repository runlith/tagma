---
id: 01a16df2-5f77-7b67-848a-4e70cf13a9de
title: "Dissect the executions package tests: duplicates, unit and narrow conformance"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16def-d932-75f8-a82f-be545d3725b8",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Per host-root order only the current group is done: the upstream smoke FilePosition removed and the spawner moved to unit with no real resources and the same four scenarios. Typecheck and seeds 1–3 green. Two changed files cost 0.3 s CPU in the source packet; after removal FilePosition costs 0, the spawner costs 0.3035 s in a separate cold seed-3 run (seed 2: 0.3717 s). These are different conditions, so no speedup factor is established. The other 13 files were read and left unchanged; no overall after was measured per the order to stop widening the work. Results: executions-kit.tsv in the host-root scratch.

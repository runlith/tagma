---
id: 01a16e74-c3c5-765a-b7a3-8eaeca60548c
title: Cheapen stepDebt and baseMerge and delete graphFixture self-checks
ord: 31
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16dee-2ab6-7368-a8dd-8e28322636c7",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16e4b-f583-73c5-b740-8b3a6ba0d3cf
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
Per the accepted audit remove repeated Git stepDebt scenarios through the owner's existing public port, leaving one record/Holdings/Git boundary; build no new port. Merge staged and submit in baseMerge, delete 9 graphFixture self-checks covered by testbed/worlds. Take a CPU profile before edits, check changed tests separately on seeds 1–3 and bun run typecheck; record measurements in x10/x-exec-b.tsv. Per the operator's updated word bring the current work to the end and land it with no hard stop; start nothing new after 17:10Z. No rollbacks or stash; final after landing all own lines.

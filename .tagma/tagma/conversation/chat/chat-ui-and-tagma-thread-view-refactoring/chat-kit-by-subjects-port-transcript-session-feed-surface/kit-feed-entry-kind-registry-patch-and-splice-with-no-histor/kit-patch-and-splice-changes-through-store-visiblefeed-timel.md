---
id: 01a11901-470f-7498-99ae-69e86e1372ac
title: "Kit: patch and splice changes through store, VisibleFeed, TimelineFold and row model; bench with budget"
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a118f1-5f59-7eb8-856a-a0e18d75d711
  - kind: waits-on
    to: 01a11901-470f-7498-99ae-69e618d547b2
---
Per [[8d75d711]]: the store yields patch/splice, floors take and yield changes, patch escalates to the affected groups' splice, interludes by index; `transcriptDelta.bench.ts` on three axes with a median-ratio budget.

Done: bench within budget; the tool-state patch → settled-group test with no doubles.

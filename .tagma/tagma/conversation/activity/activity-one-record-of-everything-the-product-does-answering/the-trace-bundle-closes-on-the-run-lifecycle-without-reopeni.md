---
id: 01a111c0-a6a5-7a73-8f4d-f9f02a1c3703
title: The trace bundle closes on the run lifecycle, without reopening; delete schemaVersion and namedDrop
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a111c1-a039-7b1e-a866-7f1904769e86",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a111ad-1d14-7079-ad84-43a6a5fd6a10
sources:
  - kind: file
    ref: packages/trace-bundle/src/bundle.ts
  - kind: file
    ref: packages/trace-bundle/src/replay.ts
  - kind: file
    ref: packages/trace-bundle/src/TraceBundles.ts
---
Order, step 1 of the spec. `TraceBundles` no longer returns the bundle to open after `run-ended`: the ended run's fact is appended without reopening, the number comes from the in-memory closed index, the log is not re-read; `REOPENING`/`SETTLING` are deleted; closing is single. Delete the manifest `schemaVersion` and `namedDrop` in `replay.ts`. Done when the store itest shows: a bundle with late facts after `run-ended` is evicted by `retain()`, the log is not re-read on a late fact.

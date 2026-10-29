---
id: 01a13dc8-de02-78bd-b4a9-dbd024914fd7
title: Migrate the cache curve tests to the shared Effect layer
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/cache/ThreadCacheCurve.test.ts
---
Migrate ThreadCacheCurve.test.ts to effect-test and the shared observations/curve layer once per group. Keep the sample, oldestAt, warm/cold/partial and bucket/provider-isolation checks; shrink the data to a minimal sample overflow. Proof is the cache tests, typecheck, clean check_law and an independent review.

---
id: 01a1402e-66c0-7963-890f-ec382d310415
title: Finish migrating the summarizer integration tests to Effect
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13d30-d804-7b33-9b8b-12527b27377d
sources:
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompactionSummarizer.itest.ts
---
In ThreadCompactionSummarizer.itest.ts remove the runners from nextTurnMessages and the Promise wrappers around Effect, type refusals/assertions with no unsafe casts. Keep the 6 contracts of own/foreign/default summarizer, quota fallthrough/named failure/no-summarizer and multi-pass folding. The test uses its own world with no conformance/compaction helpers; nobody holds its lines. Touch neither production nor the shared scriptedWorld/storage cut. Checks: serial file test, scoped typecheck, law, one Sol+Muse review; diff/evidence to the parent before landing.

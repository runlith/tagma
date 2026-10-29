---
id: 01a13fd2-137e-7823-9ff8-c57177e1786d
title: Migrate the parked questions to scoped Effect tests
ord: 17
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
    ref: packages/agent/src/thread/conformance/parkedQuestions.ts
  - kind: file
    ref: packages/agent/src/thread/run/ParkedQuestions.ts
  - kind: file
    ref: packages/agent/src/thread/run/Questions.parked.test.ts
---
Migrate Questions.parked.test.ts to @runlith/effect-test: scope and clocks belong to the test, helpers return Effect/Layer, doubles implement full tags and hide no contracts behind casts. Keep the unsettled outcome of typed failure, defect and interruption, cancelling only one's own run, expiry with resume, dedup of identical answers and refusal of differing ones, bypass after park and deadline choice. Check durable state and typed outcomes instead of mock bookkeeping; use the existing memory/transition fixtures when their contract matches. A production bug with a clear root gets fixed red→green, keeping spans. Each test file separately with --parallel=1, bun check -p packages/agent, scoped law and one Sol+Muse round. ThreadAggregate and a01ffa22 are out of this delivery.

---
id: 01a13e0b-4d7e-7dca-91fe-3855a36233eb
title: Migrate the transcript pages, attribution, tool settlement, pictures and summary refusal tests to Effect
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13db8-6291-708d-abe5-d21ebd6a6d17",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/summaryStrategy.test.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadAttributions.test.ts
  - kind: file
    ref: packages/agent/src/thread/storage/InMemoryAggregateStorage.ts
  - kind: file
    ref: packages/agent/src/thread/toolPictures.test.ts
  - kind: file
    ref: packages/agent/src/thread/ToolSettlements.test.ts
  - kind: file
    ref: packages/agent/src/transcript/page.test.ts
---
Migrate the five files page, ThreadAttributions, ToolSettlements, toolPictures and summaryStrategy to @runlith/effect-test. Keep paging and attribution-read bounds, tool claim release only after commit/delivery, picture normalization and refusal, typed summary refusals and quota fall-through. Remove partial casts and runner helpers with no boilerplate growth; the group's tests, typecheck, check_law and one review round prove completion.

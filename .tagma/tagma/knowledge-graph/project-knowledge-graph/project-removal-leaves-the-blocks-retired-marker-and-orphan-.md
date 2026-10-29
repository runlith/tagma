---
id: 01a0cab3-b851-7f6d-9333-f785cd8ce735
title: Project removal leaves the `blocks-retired` marker and orphan journal rows; only the rows are claimed deliberate
ord: 137
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/attach.ts
    symbol: switchIfDue
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/removal.ts
    symbol: projectRemoval
---
`remove` purges blocks, sources, findings, edges and the row, but neither the project's journal rows nor its `blocks-retired:N` meta key: the event delete lives only in the birth rollback beside it. The orphan rows are claimed deliberate ([[1e7ab8e0]]); the marker — written by the serving switch, read by the write gate and the registry — is residue no sentence states, and nothing re-registers the name against it.

Done when removal deletes the marker beside the row, or states why a removed project's retirement mark must outlive it — and [[1e7ab8e0]] is re-read against whichever is decided.
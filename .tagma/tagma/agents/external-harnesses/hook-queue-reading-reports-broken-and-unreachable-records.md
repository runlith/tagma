---
id: 01a127ef-4a2f-7da7-a56a-051ed17b7667
title: Hook-queue reading reports broken and unreachable records
ord: 62
tags: ["task"]
fields:
  {
    "holder": "tagma:01a127e1-03e4-7718-add9-abc6a956d4a3",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a127b4-0662-7e33-94b6-62cf120ee1fa
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/pendingWrites.ts
    symbol: listPendingOps
---
`listPendingOps` skips broken JSON and a bad shape with no diagnosis, and one file's read error aborts the whole flush of the session. Give the queue owner a typed reading result that keeps failure evidence: available records keep flowing, and a lost read is named in the hook diagnosis. Prove with a mixed queue holding a good and a broken record, plus a separate access refusal; the work does not change `record_write` outcomes.

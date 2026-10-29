---
id: 01a0f515-32a7-75cf-87a3-75f0649a2702
title: Bound rewind attribution and trace payload work at their producers
ord: 118
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f508-6715-76a5-9f68-ee40cfb8fedb",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/HistoryAttribution.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadRewind.ts
  - kind: file
    ref: packages/trace-bundle/src/PayloadWorker.ts
---
Remove the measured full-journal replay/retry amplification in rewind points and the main-loop cost of large trace payload handoffs. Preserve rewind, restore, compaction and retained trace semantics, make repeated reads incremental with bounded ownership and cancellation, and verify through owner-level tests and focused performance evidence. The running server must not be restarted; delivery is source commits plus the exact unverified deployment boundary.
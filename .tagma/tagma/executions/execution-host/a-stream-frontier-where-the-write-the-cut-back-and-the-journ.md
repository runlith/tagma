---
id: 01a16675-ba00-7c2f-8f1b-dad78a43d7ae
title: A stream frontier where the write, the cut-back and the journal line all failed, the next logic takes by payload length
ord: 39
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16643-0934-7ef4-b48b-a8a3c7479dac",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16642-c9b6-7f42-842c-a9b29a8bc9e2
sources:
  - kind: symbol
    ref: packages/execution-host/src/ExecutionRecord.ts
    symbol: makeSegmentRecord.suspend
  - kind: symbol
    ref: packages/execution-host/src/RecordWriter.ts
    symbol: makeRecordWriter.reopenSegment
---
When an append fails and the carrier takes neither the segment cut-back (`truncate`) nor the error `Closed` journal line suspend writes, the fenced stream's frontier lives only in the departing logic's memory. The next logic opens such a stream as open and takes the frontier by the segment payload's length (`reopenSegment`), so bytes past the confirmed point — a half-laid append or a write laid after the cut — count as taken for it.

What is needed is a frontier or an "unavailable" state that survives a journal refusal and that reopen respects. For example a mark in the execution store next to departure, or reopen refusing to continue a stream whose payload outruns the last confirmed frontier. Decide which carrier owns that fact, and prove it with a scenario: failed append, failed truncate, failed journal line, suspend, reopen.

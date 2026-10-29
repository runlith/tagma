---
id: 01a14cf8-6242-70e6-a782-5ed82cc78913
title: "Parity: the terminal is the single owner of the turn end, with requests and context reading from the transcript and declared weakenings"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14dd1-43cd-7723-af0a-5cf815955c6a",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-6087f822dd50
  - kind: waits-on
    to: 01a11ca5-7ddf-7f42-a891-bd6686d3a9ca
---
Implement [[f822dd50]] after the terminal is on the core ([[86d3a9ca]]); the first cut is [[f8ea396d]]. Terminal context reading proves no cache lifetime and writes no `cache.ttlSeconds`: `threadCacheWarmth` no longer substitutes the catalog lifetime ([[7fc75b4f]]) and answers `unknown` for such a reading. Included here — the Esc scenario in the Claude terminal TUI (the `terminal/watch.ts` observation): the run ends `aborted`, `stoppedBy: reader`, with no interruption record; [[bccb479c]] proves only the Cursor Stop hook with `status: aborted`. Proof — the part criteria, commit.

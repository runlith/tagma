---
id: 01a14f5f-4414-7cea-89c1-e6ff7bc3f09e
title: A child report that woke an ACP thread appears in the feed only after the turn's answer
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14c6e-0964-7380-a06d-52d9a91ff09c",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a116de-c806-7b70-8440-4711fb0b1868
sources:
  - kind: file
    ref: packages/agent/src/thread/run/lifecycle/readSignals.ts
  - kind: file
    ref: packages/agent/src/thread/run/scheduler/openings.ts
---
A child report that woke an ACP thread shows in the feed only after the turn answers. Noticed by the operator in thread 01a14f36: a reviewer answered, the ACP thread woke, but there is no child message in the feed while the turn runs. Cause: `openings.open` deferred the whole turn-open event for a receipt transport (`words: receipt`) — both the reader words the adapter writes on receipt and the letter or report signal the adapter never writes; the signal only appeared from `fate('read')` at the turn's end, after the answer. Fix: only the reader words are deferred, the signal is written at opening, as with native; `fate('read')` does not rewrite an already standing signal (`readSignals`). Proof — `protocolWords.stest`: a letter that woke the turn stands in the journal while the turn runs, and single.

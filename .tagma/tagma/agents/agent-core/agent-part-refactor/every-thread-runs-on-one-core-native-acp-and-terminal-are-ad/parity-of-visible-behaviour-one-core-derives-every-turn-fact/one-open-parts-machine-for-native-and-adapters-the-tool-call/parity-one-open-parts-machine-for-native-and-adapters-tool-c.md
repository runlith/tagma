---
id: 01a14cf8-620e-7b70-b92d-93fc7bcc71f8
title: "Parity: one open-parts machine for native and adapters, tool-call input and request retry"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14cfa-01c7-7c57-8276-9b8a4d9df8f3",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14cba-e095-7bcb-bb6f-60818dd27b1e
---
Implement [[8dd27b1e]] after [[424c0878]]: `OpenParts` instead of `LiveTails` and the recorder's parts, `_tagma/input` and `_tagma/retrying` on the runner, partial display through the hosting port, the snapshot of open inputs into `streamTail` and its fate on Esc, retry, process death and adoption. Proof — the part criteria, commit.

Done in 76d199bf02 and 52e58cf043 (review fixes). Proven: `OpenParts` unit, the runner contract (`_tagma/retrying` with family, `$/tagma/input` in block order, the subagent stays silent), transport conformance on memory and SQLite (a retry writes a record with `retryEntryId` and closes the pending input with a reason, a report retry after the next request is a replay; a turn end lands open text and input as interrupted), protocol stest (scripted agent: input and retry give a `retry` record and interrupted input).

The parity suite (081b287102) proves on native and scripted `acp`: input in three deltas with one partial display; Esc and a server crash with live-process adoption mid-input land it `input-interrupted` once, process death too (only `acp`); a request with 529 writes one `retry` record with `retryEntryId(run, 0, 1)` and a `retrying` phase, and both survive a server crash. Stop mid-text is covered by the parity-end scenario. Partial display and `acp` composition in the suite need `open_hosted_turn`, which the real runner calls through its door: the scenario makes that call for the scripted agent. Not proven: a retry with `attempt: 2` on native in the suite (covered in transport conformance).

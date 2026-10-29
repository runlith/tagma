---
id: 01a14cb4-6b5b-7cd9-9f88-81495812e469
title: Bound execution-host output storage without tying its life to the server
ord: 24
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a14c18-c833-7d88-b3bd-66ec88ce8e39
  - kind: relates
    to: 01a136b1-d78a-7f67-9c39-85f61d5d6619
sources:
  - kind: symbol
    ref: apps/tagma/server/src/executions/host/boot.ts
    symbol: raiseHost
---
Eliminate the unbounded growth of diagnostics that raiseHost directs into an append file inside state: the returned 16 KiB bound only the answer, the acting holder/logic writes the full output indefinitely, and every new raise leaves one more attempt. makeTempFile creates a nested boot-* directory with a .log file; sweepBoots picks up only boot*.json. Define and implement at the record owner a bounded volume of live output and retention of finished attempts, keeping stdout and stderr capture, the early-refusal cause and a server-independent lifetime for inherited fds. Server-side cleanup of old files alone doesn't bound an active writer after the server leaves. Proof — the bound holds under long output and repeated raises, with no loss of early-refusal diagnostics, EPIPE, or host-life change. Growth rate and disk fill are unmeasured; the defect is confirmed by a full read of the producer and its calling chain in an independent review.

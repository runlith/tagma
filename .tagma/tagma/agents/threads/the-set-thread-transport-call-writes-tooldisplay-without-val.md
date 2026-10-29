---
id: 01a141b9-f42f-7c10-8b77-e5d96c03d016
title: The set_thread_transport call writes toolDisplay without value, and the caller's turn breaks with ThreadTailLostError
ord: 121
tags: ["task"]
fields:
  {
    "holder": "tagma:01a141ba-1008-729b-a48d-bc0a64465fb0",
    "status": "done"
  }
---
The parent thread's turn broke after a `set_thread_transport` call (`threadId` = the harness thread `01a141b5-fdb7-7bb0-a18e-2b3df6f37cab`, `transport: terminal`): the call itself returned "The run ended before this tool call settled", and the run fell with

```
ThreadTailLostError: The run ended without writing its last output: Persisted thread event entry cannot be read — Transcript entry tool:toolu_01JwFFiB9g5dQ8XvPmWD5Fds of kind tool cannot be read: Missing key at ["toolDisplay"]["facts"][0]["value"]
```

Thread `01a125fe-9260-7644-9a64-589c9bc19e19`, record `transcript:error:01a141b8-2de0-7612-b849-19eefff86399`, run `01a141b8-2de0-7612-b849-19eefff86399`. A repeated same call passed (`status: unchanged`), i.e. the first effect applied, but its record written in a shape its own reader does not read.

Find who writes `toolDisplay.facts` for this call without `value` (the writer, not the reader), and fix at the shape's owner: writer and schema must match. Check whether other operations share the hole.

Done when: `set_thread_transport` both ways on a harness thread passes in a turn that continues after the call; the record reads; the contract closed with a test on the owner's layer.

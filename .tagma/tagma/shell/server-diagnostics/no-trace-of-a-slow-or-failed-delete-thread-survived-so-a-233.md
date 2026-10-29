---
id: 01a0c61d-e8dd-7f53-9b0f-237c3f739edc
title: No trace of a slow or failed delete_thread survived, so a 233 s operation could not be decomposed
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "`slow` over the incident window answered `spans: []`. With no `since` it answered exactly ONE span for that name across the whole retained range — 37.2 ms, from 1790023810828, an hour before the incident. The metric for hour 1790028000000 meanwhile counted 35 completions, 233,452 ms, one failure, with 21 occurrences in (4096, 8192] ms and 10 in (8192, 16384] — so the completions were counted and none of the expensive or failed ones left a span to open.",
    "command": "read_performance({type: \"slow\", name: \"delete_thread\", since: 1790027900000, limit: 8}), then the same read with no `since`, beside read_performance({type: \"metrics\", name: \"delete_thread\", since: 1790028000000})",
    "expected": "At least the slow and failed occurrences of the hour retained, so `breakdown` could say where their elapsed time went — the reports state that a trace is stored whole or not at all, and that every slow, failed and stalled one is stored."
  }
---
Filed from project `runlith`.

Measured cost: the investigation could not attribute the 233 s. What the operation's children cost had to be inferred instead from per-name histogram totals over the window (`Terminals.stopCommands`, n=36, 65.8 s was the only per-delete-shaped heavy child) and from arithmetic on the tool-call durations in the calling thread's own records — eight deletes issued at 22:17:35.033 UTC finished at 6.27, 6.27, 6.27, 6.27, 8.40, 9.63, 9.67 and 10.75 s. Roughly 167 s of the 233 s stayed unattributed, and the report says so rather than guessing.

Process counters at the time of the reads: `losses` with source "live" answered pressure `ready`, pendingRecords 0, persistedRecords 2,179,353, droppedRecords 1,283,305 this session, of which 1,271,368 were spans — 37% of what this process admitted was dropped. Whether the delete traces were dropped under that pressure or were never selected for storage is exactly what the reader cannot tell: `slow` returning an empty page and a trace that was dropped read the same from outside.

Two things would have settled it without widening any query: a reading that says whether a named operation's traces were stored, dropped or not selected in an interval, and — since the loss account already separates its kinds — losses that name what was lost rather than only how much.
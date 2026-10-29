---
id: 01a13291-8f8b-7315-a089-eaa54013638b
title: No door for counting tool calls by project over 14 days within the read ceiling
ord: 4
tags: ["reflection"]
fields:
  {
    "actual": "The updatedSince 2026-09-28 sample yields 2476 threads. A single-day window (2026-09-29) already hits the 30000-fact ceiling (coverage.cut: read-ceiling). where does not lower traversal cost. Activity keeps only ~25 hours (earliest run 2026-10-11T23:04). A full 14-day count needs dozens of windows; full windows covered 244 of 2476 threads.",
    "command": "read_thread select=entries, selection={updatedSince: 2026-09-28T00:00:00Z, set: all} (project runlith), group [toolName, toolState] count=true, where toolName in [graph tools]",
    "expected": "A count of graph-tool calls and their refusals over 14 days by project with coverage.complete=true, or with a clear split into full windows."
  }
---
Filed from project `runlith`.

Measurement: the updatedSince 10-11 00:00–12:00 window covered 76 threads fully (19125 facts); the 10-11 12:00–23:00 window hit the ceiling on 167 threads. Without a per-thread counter selecting the thread type (tagma agent versus code), traversal is spent on large code-agent threads.

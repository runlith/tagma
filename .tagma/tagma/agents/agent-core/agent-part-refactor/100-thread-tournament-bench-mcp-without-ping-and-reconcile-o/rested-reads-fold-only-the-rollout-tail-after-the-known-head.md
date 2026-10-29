---
id: 01a11bae-3562-7664-b2b4-841d5a674b6c
title: Rested reads fold only the rollout tail after the known head, not the whole file
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: discovered-from
    to: 01a11901-5360-733e-9ca2-9123ae16171c
---
Found in the [[ae16171c]] review (point 25), but predates this work.

`RestedReads.latestOf` (`threads/journal/restedReads.ts`) and `RestedFolds` (`native-harness/transcript/restedFolds.ts`) re-read and re-fold a rested thread's whole rollout file on every head shift. Cost grows with thread length, not with what arrived since the last read (rule 2393aff1).

Do: the latest-revision index is kept incrementally from the past head, and on a shift only the file tail after the known offset is read.

Proof: a bench on a rested thread where the second read after one fresh record reads the tail bytes, not the whole file.

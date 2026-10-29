---
id: 01a132ff-6ffa-7f16-a18a-d340e961241e
title: read_changes binds the latest native turn to an old commit with the same bytes
ord: 8
tags: ["reflection"]
fields:
  {
    "actual": "The read finished exit 0, held.paths=0; turns f1–f5 with at=1791856398622…1791856400707 answer committed=df4c646d07777a8af7d63c0ff5f60a6c646d856f, the 03:07 commit instead of the actual 03:53 final landing. The commits list meanwhile includes the correct 93ebdac. Between landings the same six files went 1→0 recorded by a landing, then 0→1 again. Corpus clean; the mismatch cause not established.",
    "command": "bun ~/.tagma/scratch/01a1321c-625d-7dd4-9e15-215bab6b3037/landing-bench.mjs thread-op 01a132be-e260-7e54-bb29-9da609ad3509 read_changes '{}'",
    "expected": "The latest recorded 0→1 writes, which submit_work landed in 93ebdac093935abe1bc30e4dd2774f75cfc59b23, show that commit in turns, or the read explains the different binding."
  }
---
Filed from project `runlith`.

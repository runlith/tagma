---
id: 01a19ccc-a70b-7b1c-a454-370b81abda85
title: Keep worktree standings on indexed clocks and latest outcomes
ord: 149
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19cbe-733b-7520-82de-9520299f1d18",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf03-7ff9-bfe7-eb4fc6922284
---
Remove per-thread history sorting from the shared outcome lookup and read activity clocks without fetching native prompt and state payloads; preserve standings, unseen results, placement and page semantics. The native list_worktrees regression fails before the fix and passes on seeds 1–3; listStore and attention add 23 passing cases. On darwin arm64, 12 cores and 32 GiB, the maintained full-operation benchmark with 3,562 threads, eight completed runs and a 64 KiB prompt each returned one main checkout in 116.51 ms first after seeding and 48.38/41.73 ms on repeat; OS cache was uncontrolled. The index build is declared heavy before handover. Consecutive delivered keep-warm runs still form a suffix the meaningful-outcome selector skips; the benchmark covers ordinary completions and does not establish a universal latency ceiling or an OS-cold bound.
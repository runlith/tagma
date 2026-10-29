---
id: 01a129c6-ad0e-7ba1-a12c-9c8cbe6f0074
title: submit_work reports lines still uncommitted on paths git shows clean after the commit
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "left named bun.lock, Interpretation.ts, ScreenCheckpoint.ts, checkpointPause.bench.ts as 'lines of this session still stand uncommitted', while git diff for all four is empty right after the commit (commit steps rewrote ScreenCheckpoint.ts and checkpointPause.bench.ts)",
    "command": "submit_work paths=[ScreenCheckpoint.ts, Interpretation.ts, checkpointPause.bench.ts, bun.lock, …] → landed 2227103491",
    "expected": "left names only paths where this session's lines still differ from HEAD"
  }
---
Filed from project `runlith`.

Cost: one extra git diff to prove nothing was left. Possibly the judgement is taken before the commit-step rewrite is reconciled with the working files.
---
id: 01a0ca95-00c4-7704-84e8-3d0d437852f9
title: Decide grep's unbounded stat fan-out
ord: 20
tags: ["task"]
fields:
  {
    "status": "closed"
  }
---
In `packages/agent-tools/src`: (1) `glob.ts` times matches at `STAT_CONCURRENCY = 64` (glob.ts:32) while `grep.ts` stats each matched file with `{ concurrency: 'unbounded' }` (grep.ts:197) — a common pattern matches thousands of files, so the unbounded fan-out wants a bound or a recorded reason; [[deabdf04]] pins the found behavior without that reason. (2) is resolved: both doors now answer a page past the last match as no rows against the full count (grep.ts:226, glob.ts:153-158), pinned by [[adea35d3]]. Decide (1), then update the claims under [[3c142bcc]].
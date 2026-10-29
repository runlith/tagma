---
id: 01a145ce-5070-7faf-8412-78c62f1c1475
title: "Autocompaction after a restart at 67% of the window: a tool-set change dropped the thread measurement, and the context was re-estimated with the model weight"
ord: 58
tags: ["task"]
fields:
  {
    "holder": "tagma:01a145b4-fc48-77ae-9547-3bbf52137b7a",
    "status": "done"
  }
sources:
  - kind: file
    ref: packages/agent/src/thread/compaction/calibration.ts
  - kind: file
    ref: packages/agent/src/thread/compaction/ThreadRequestMeter.ts
  - kind: file
    ref: packages/agent/src/thread/run/ThreadCompaction.ts
---
Thread `01a125fe-9260-7644-9a64-589c9bc19e19` (Opus 5.5, trigger 80% of 1M = 800K) went into automatic compaction on the first run after a server restart, although the last measured request was 551,612 tokens. Receipt: cause `projected`, projectedTokens 886,880, usable 800,000, measuredTokens missing.

## Cause

- After the restart (build `6ce46cc8c3`, 17:11:56Z) the first run lacked 36 MCP tools (chrome-devtools, vidin); 17 of them stood in the last measurement footprint.
- `ThreadRequestMeter.opensOn` refused the measurement on any prompt or tool-set (`tools`) mismatch, and estimation fell back to the whole request: raw chars/4 ≈ 732.5K × learned model weight `claude-opus-5-5` 1.2107 = 886,880.
- That thread's own ratio is ≈0.75 (551.6K actual per ≈732K raw); the model weight averaged over all threads misses a single thread by tens of percent. Any base loss gave the same jump: a plugin or MCP server, rebuilt tool descriptions, an updated prompt, a new prune of old tool outputs inside the measured prefix.

## Done

- A measurement stays the anchor while the message prefix matches: a changed prompt and tools missing from the measurement are estimated, vanished ones stay inside the measurement.
- Everything the measurement does not cover is estimated from that thread's own ratio (`measuredWeight`: measured / covered within calibration bounds) — tail, new tools, and requests the same `prepare` no longer covers: after a new prune, after media omission, after every fold in the compaction loop.
- A request that no longer proves the prefix after a new prune or fold is estimated from the stored history the measurement was taken on.
- Per review (Sol xhigh, Wonder xhigh): a replaced prompt enters the ratio denominator at its replacement size, otherwise the ratio inflated (40K prompt + 40K history → ratio 2 and false 240Ks); a deferred tool offered by one name gained its own digest, and its reveal after measurement is estimated by the full definition.
- Not closed: raw of vanished tools stays unknown, their share overstates the ratio (early-compaction side); rewind makes reads stale, and the next estimation goes by model weight.

## Proof

`ThreadCompaction.itest.ts`: "a request that no longer sends a tool its measurement carried…" and "a history pruned under its measurement…" — on the old code both requests compacted (≈210K and ≈180K at 168K usable); "a replaced prompt is no reason…" gave 240K on the pre-review version. `ThreadRequestMeter.test.ts` — the anchor contract on prompt and tool-set change and deferred-tool reveal after measurement. Commit `3c0d443952`.

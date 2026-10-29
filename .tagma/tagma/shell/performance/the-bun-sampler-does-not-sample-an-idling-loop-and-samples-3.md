---
id: 01a1366b-3157-7c95-9942-2ad0a7cbab1e
title: "The Bun sampler does not sample an idling loop and samples 3–4x rarer than asked: the profile weights a sample by one period"
ord: 25
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/CpuProfile.ts
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
---
JSC (Bun) takes no samples while the loop thread idles and reports the whole idle gap in the `timeDeltas` of the first sample after it. Summing deltas as selfMs attributed seconds to the frame that woke first after the idle (`LoopStalls`, `getCont`), and the stall named the wrong frame. So a sample's weight is its delta, but no more than the lower quartile of the profile's positive deltas: inside work the delta is the period; after idle it is one period. The quartile, not the median — so that a quiet process's window, where idle gaps outnumber back-to-back samples, does not mistake a gap for the period. A window of a few scattered samples carries no period and is read by sample count. So a stall names a frame only when the samples saw the loop busy for at least half the stall — the same threshold that divides cpu and blocked; otherwise the sampler never saw what the loop was busy with, and the first sample after the gap is not the cause. Busyness here is measured not by quartile weight but by the deltas between adjacent samples inside the stall no longer than four periods: the quartile on real Bun jitter (deltas 1–6 ms with quartile ~2 ms, one measurement 2026-10-23) understated a busy block nearly twofold and dropped it below the threshold, while a profile quartile made of gaps alone equals the gap and passed a lone sample after idle off as coverage. A sample with no neighbour inside the stall adds no busyness. The report always gives the sample count and the observed time, with or without a frame. A V8 profile with `(idle)` samples is unchanged by this.

JSC holds the requested interval 3–4x slower (measured 2026-10-13: 10 ms → 33–50 ms, 1 ms → 3–4 ms), and with the old 10 ms a 100–400 ms stall got 1–3 samples. The interval is a hundredth of the stall ceiling (1 ms at 100 ms): 25–30 samples per stall at the ceiling. The cost in a nearly idling process is 0.40% of a core versus 0.23% at 10 ms.

A stall with nearly zero cpu and loopCpu of the frame has no frame: the loop executed nothing — the process got no CPU or the timer woke late.

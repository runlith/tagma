---
id: 01a14107-6edd-7deb-a61b-63b15d2889dd
title: Stall report names a one-sample frame as the cause of a blocked stall and prints process CPU as if it were the loop's
ord: 11
tags: ["reflection"]
fields:
  {
    "actual": "It prints `frame (anonymous) at packages/agent-tools/src/CheckoutBaselines.ts:319` and `cpu 454.9 ms over 509.3 ms`. The raw profile shows only 4 samples in the 484 ms interval: one 489 ms gap with no samples, then CheckoutBaselines.ts:320 as the first JS frame after it (1 sample, ~1 ms). The 454.9 ms is process CPU; loop CPU stays unprinted, though the `blocked` cause means it was under half the window. The operator and a delegating agent read this as \"checkoutState burned 455 ms on the loop\" and commissioned a fix to the wrong owner.",
    "command": "read_performance({type: \"stall\", id: \"925446e7-886c-4008-8062-e265c9fe1066\"})",
    "expected": "A `blocked` stall whose interval holds only a handful of JS samples says it has no blocking frame (or shows the frame with its sample count and share of the interval), and prints the loop thread's CPU next to process CPU."
  }
---
Filed from project `runlith`.

Evidence: profile 57467f45-7c83-4674-a488-b4cffd8d9b6b (raw .cpuprofile). Samples near the stall: a burst of `spawn` frames up to monotonic 2533523.5, then nothing until 2534013.0 (delta 489.4 ms), resuming in CheckoutBaselines.ts:320. The span trace (checkoutState a889c1b999a467e1) puts the whole interval inside the child `Git.spawn` (git status running), and checkoutState's own synchronous work after it took ~0.14 ms. Stall fed03673-866c-402c-a0c6-b7a2a01b56c5 has the same signature (560 ms sample gap, blocked, ~440 ms process CPU) with no checkout work at all, and there the report printed `frame —`. `blockingFrame` in packages/performance/src/CpuProfile.ts ranks the frames inside the interval with no floor on sample count, so a gap's first frame after waking can be presented as the stall's frame.
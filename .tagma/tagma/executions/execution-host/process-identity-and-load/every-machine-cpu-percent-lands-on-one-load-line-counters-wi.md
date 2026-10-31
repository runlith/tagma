---
id: 01a11bae-33a8-7132-9b8d-087f4f7c55d5
title: "Every machine CPU percent lands on one Load line: counters with reaped descendants, the machine remainder is the System line"
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/src/usage.rs
  - kind: file
    ref: packages/execution-host/src/ProcessAccount.ts
  - kind: file
    ref: packages/execution-host/src/processSpending.ts
  - kind: file
    ref: packages/execution-host/src/ProcessUsage.ts
---
Where the adapter's process counter includes the time of reaped descendants (macOS `ri_child_*`, Linux `cutime`+`cstime`), work born and finished between passes shows in the parent counter's growth instead of being lost. An execution container counter instead measures the whole execution's growth; without either source the execution figure is a lower bound. When a process leaves, its last read value is subtracted from the nearest living ancestor that reaped it, through the chain of those gone in the same interval; without that the leaver's past time would count twice. The execution leader is reaped by the holder: its last fragment moves to the execution's line only out of the holder's measured descendant growth in the same interval, as an equal write-off and accrual. The final rusage yields such a fragment given a previous leader read or proven birth inside the interval. A belated ending without that base stays in the holder's already measured line: lifetime CPU can never be accrued again in the current interval or written off from future reads. A process with no previous read accrues whole only if born inside the interval, otherwise its rate is unknown and counts as unread, not zero.

Descendant-reaped time enters the process figure but never hides in it: out of the accrued, the process separately carries the part its reaped descendants spent (`reapedCores`) — the accrual above its own counter's growth — so leaver write-offs and execution returns come out of it, and own plus descendants always sum to the accrued, never counted twice. Without this part a server that reaped dozens of `git status` in a pass looked in Load as if loading the machine itself. A counter read through `ps` holds no descendants and carries no part.

One process's counter can come from rusage (with descendants) or from `ps` (without) when the system refused rusage. Two such reads compare on own time only: a totals difference would take for the interval's CPU everything the process reaped in its life (a tens-of-cores jump), and nobody knows descendant growth across such a boundary — it stays in the new base. A gone descendant's write-off and the holder's return apply only to a figure where descendants are comparable. If a descendant left while its ancestor's counter was still unread, the write-off awaits the ancestor's first comparable read, otherwise the descendant's reaped time would accrue a second time.

The gap between machine CPU and the process sum is the kernel (`kernel_task` is visible to neither `ps` nor rusage) and interrupts; the System line shows it. If the process sum exceeds the machine (skewed read moments), there is no System line and the line sum exceeds the machine by that skew. The interval is measured by the sampler's own clock at the counters' read moment, not by the answer's arrival time at the host. On Windows descendant reaping does not count (`child = 0`).

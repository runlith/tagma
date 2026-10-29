---
id: 01a14c05-9e8f-7c75-a633-b2b1df27ae3e
title: An agent takes a server CPU profile and gets it for analysis or opening in a profiler
ord: 2
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2b00fb170e3
sources:
  - kind: file
    ref: apps/tagma/server/src/performance/operations.ts
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
  - kind: file
    ref: packages/performance/src/CpuProfiles.ts
  - kind: file
    ref: packages/performance/src/reports/profiles.ts
---
**Value.** An agent gets a CPU profile of the chosen window and finds the functions that held the processor in a reproducible problem.

**How.** `capture_performance_profile`, then reading the profile via `read_performance`.

**Behaviour.** Manual captures go one at a time and are kept for later analysis. A capture starts the sampler on its window and stops after, when the standing sampler is off — and it is off by default. An event-loop stall inside the window keeps its own profile and is marked as a cut-out part of the manual capture. Reading ranks frames, and the source profile can be had as `.cpuprofile`: to a thread — as a file in scratch, with no fitting scratch — inside the answer.

**Limits.** The current server process is captured, not an arbitrary machine process or another host. A kept window may be shorter than requested because of cut-out stalls; this is not a user mode for recording a repeat problem.

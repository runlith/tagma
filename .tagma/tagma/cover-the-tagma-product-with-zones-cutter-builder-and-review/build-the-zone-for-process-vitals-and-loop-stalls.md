---
id: 01a0c83d-bf13-75bf-942c-b50198d90c55
title: Build the zone for process vitals and loop stalls
ord: 93
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0c83d-be5e-7beb-99fc-b3492a74de70
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: packages/performance/src/LoopStalls.ts
  - kind: file
    ref: packages/performance/src/ProcessVitals.ts
---
Wave 1, builder: [[d115a499]] of [[2a74de70]] — `src/ProcessVitals.ts` (117), `src/LoopStalls.ts` (90). Small, and every line of both is worth a reading.

Leads: the loop-delay histogram's resolution and the extra sleep before it is read; the allocator counters, absent rather than zero where the runtime stops answering; the vital carrying the store's pressure and what taking that reading rotates; the pulse at a quarter of the ceiling; the per-thread CPU reading taken only where the runtime offers it, and what the window figure is for; naming the trace before cutting the profile, and why the cut is at the first instant the loop runs again.

The profiler door is [[e4e8b32f]]'s, the sampler [[d6c0265b]]'s, the stall's report [[1f61148e]]'s: claim what these two files decide.

Done when the claims stand verified, `run_doctor` over both files is clean and the review passes.
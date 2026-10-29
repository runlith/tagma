---
id: 01a0c83d-bf26-7c87-9e52-76d9050021ba
title: Build the zone for CPU profiles
ord: 94
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
    ref: packages/performance/src/CpuProfile.ts
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
  - kind: file
    ref: packages/performance/src/CpuProfiles.ts
---
Wave 1, builder: [[e4e8b32f]] of [[2a74de70]] — `src/CpuProfiler.ts` (167), `src/CpuProfiles.ts` (103), `src/CpuProfile.ts` (216). Read all three whole.

Leads: one profiler per isolate and the single permit over the session; the rotation running on the observed loop on purpose; `cut` against `window`, and what each answers when nothing is open; the binding for a host that runs no profiler; the sampling interval derived from the stall ceiling; how an operator's request is queued and what it is refused for; the artifact schema and what a stored profile keeps of it; folding an artifact into frames, and finding the frame that was blocking across an interval.

The stall that asks for a cut is [[d115a499]]'s and the stall report that reads the frames is [[1f61148e]]'s; the schemas this file supplies to the protocol are still this area's to claim.

Done when the claims stand verified, `run_doctor` over the three files is clean and the review passes.
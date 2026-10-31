---
id: 01a1941f-f2bb-77f3-9717-6551c6976cf6
title: Keep a published CPU-profile cut readable through its public reader
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-8771d5cafaa8",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a190c4-acfe-7d01-807a-6f2434bf0b53
---
The unreadable cut was a schema mismatch between writer and reader, not lost durability. A stall cut taken under half a millisecond after its window opened stored `requestedDurationMs: Math.round(<0.5) = 0`, while the stored-profile schema demanded a positive duration, so `readRecord` answered `PerformanceRecordUnreadable` ("is corrupt") for a record that was durably present; later, longer cuts decoded. 43303995f split the stored fields (duration ≥ 0) from the capture request (duration > 0).

Checked on current code: the pre-fix request fields refuse the payload of a 0.25 ms cut and the current `cpuProfilePayloadSchema` accepts it; `CpuProfiles.itest.ts` (4 pass) captures an early 0.25 ms cut and a later cut inside a manual window and reads both, raw, through `PerformanceReports` right after `capture` returns, so publication-then-read ordering holds through `submitDurable`'s acknowledgement. The original record 11b06b0e was removed with its fixture; its exact bytes cannot be inspected, so the match rests on its scenario (a cut before the measured window, three later cuts readable) and the fix landing 12 minutes after the report.
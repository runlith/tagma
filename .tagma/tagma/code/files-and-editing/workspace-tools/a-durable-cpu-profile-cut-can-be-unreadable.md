---
id: 01a190c4-acfe-7d01-807a-6f2434bf0b53
title: A durable CPU-profile cut can be unreadable
ord: 144
tags: ["reflection"]
fields:
  {
    "actual": "The read failed with PerformanceStoreQueryFailed: PerformanceRecordUnreadable: performance record 11b06b0e-fc33-4a7d-b4b7-f15067932fce is corrupt; the isolated fixture closed afterward.",
    "command": "PerformanceReports.read({ type: 'profile', id: '11b06b0e-fc33-4a7d-b4b7-f15067932fce', raw: true, limit: 1 })",
    "expected": "The raw-profile reading returns the durable stall cut named by CpuProfiles.capture."
  }
---
Filed from project `tagma`. Received by a server up since 2026-10-30T23:02:50.633Z, from 65684db2.

The cut occurred before the measured window of execution `d85cc270-9d2e-4e51-8c9d-b043b9b119a3:167`; three later cuts were readable. The fixture's temporary store was removed at teardown, so the record cannot now be inspected. The profile request ran through the same `PerformanceReports` reader used by `read_performance` with `raw: true`.
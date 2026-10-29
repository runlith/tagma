---
id: 01a0c83d-be5e-7beb-99fc-b3492a74de70
title: Performance
ord: 38
tags: ["module"]
fields:
  {
    "entries": [
      {
        "at": "src/CpuProfile.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606",
          "d2a60527",
          "97a922df"
        ]
      },
      {
        "at": "src/CpuProfiler.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/CpuProfiles.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/HeapSnapshot.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/HeapSnapshots.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/LoopStalls.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/MemoryCaptures.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/MetricSnapshots.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/protocol/records.ts"
      },
      {
        "at": "src/protocol/queries.ts"
      },
      {
        "at": "src/protocol/reports.ts"
      },
      {
        "at": "src/PerformanceReports.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606",
          "d2a60527"
        ]
      },
      {
        "at": "src/store/store.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606",
          "d2a60527"
        ]
      },
      {
        "at": "src/store/records.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/store/wire.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/PerformanceTracer.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/ProcessVitals.ts",
        "for": [
          "90491249",
          "9bb175ec",
          "13182a9f",
          "f37a2606"
        ]
      },
      {
        "at": "src/HeapSummary.ts",
        "for": [
          "97a922df"
        ]
      },
      {
        "at": "src/HeapReader.ts",
        "for": [
          "97a922df"
        ]
      }
    ],
    "id": "@runlith/performance",
    "kind": "kit"
  }
edges:
  - kind: imports
    to: 01a0c6f2-a586-7323-a199-02c56c81c6f3
  - kind: imports
    to: 01a0c702-bcab-7b1f-9440-825f382fa6aa
  - kind: imports
    to: 01a0fd8b-bf12-7d39-abd6-b5ffc43d3272
  - kind: imports-tests
    to: 01a13b4d-7a3d-7729-955f-a344b43ff1ba
sources:
  - kind: dir
    ref: packages/performance
---
The package observes process work and summarizes V8 heap snapshots so the operator can ask what was slow, froze or keeps growing. It owns collectors, bounded worker persistence, windowed reports and the heap file reader. Mounting products choose intervals, thresholds and storage, coordinate heavy analyses and present results.

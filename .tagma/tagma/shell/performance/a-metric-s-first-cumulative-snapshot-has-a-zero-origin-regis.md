---
id: 01a13fb8-c133-70d7-a961-d4491863dec5
title: A metric's first cumulative snapshot has a zero origin registry
ord: 30
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/performance/src/MetricSnapshots.ts
  - kind: file
    ref: packages/performance/src/reports/overview.ts
---
Readers count completions as differences of cumulative snapshots, so a name's first snapshot without a zero origin loses every completion before the first tick. The origin belongs to the registry's start, not to the first stored span: metrics include unsampled traces too. The origin and the first snapshot are kept in one retention group so retention never leaves a false zero without its first observation. Overview selects snapshots by window time and reports no-snapshots-in-interval when there are none; spans alone do not prove metric coverage of the window.

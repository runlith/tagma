---
id: 01a18514-e924-77be-afe5-f1025cb69e4d
title: A page trace's buffer is capped at 64 MB so its analysis stays under about a gigabyte
ord: 32
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4fae5c99a890
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/engine/analysis.ts
  - kind: file
    ref: apps/tagma/server/src/browser/engine/trace.ts
---
The trace engine holds every parsed event in its worker, and its memory runs five to ten times the uncompressed trace: Chromium's default 200 MB buffer let a busy page record 436 MB of JSON, which the worker parsed at 4.3 GiB of RSS — enough to exhaust an 8 GB machine. With a 64 MB buffer the same page stops at about 140 MB of JSON and 0.7 GiB (one sample each, Apple M2 Max, Chrome for Testing). A recording that fills the buffer keeps its start and answers `dataLoss: true`, which the agent reads as "trace a shorter window".

The analysis runs in a fresh worker per trace that is terminated after writing the sidecar, so no parse memory outlives one analysis, and one analysis runs at a time per server.

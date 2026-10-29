---
id: 01a18632-bc74-7631-91ef-3c26df3d595f
title: Animation callbacks do not prove a traced interaction has been reported
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/browser/testing/traceScenarios.ts
---
Chromium [increments native event counts during dispatch and publishes EventTiming after asynchronous presentation feedback](https://github.com/chromium/chromium/blob/151.0.7922.71/third_party/blink/renderer/core/timing/window_performance.cc#L565-L842). Two animation callbacks can precede that feedback, so stopping a trace then loses a completed click's pending sample. The interaction scenario observes its long click's buffered native performance entry before stopping; its click count separately proves that input arrived.
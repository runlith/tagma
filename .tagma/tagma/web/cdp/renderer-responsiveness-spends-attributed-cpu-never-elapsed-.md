---
id: 01a1a76a-aaa8-7eed-9b33-f9a8e85431e9
title: Renderer responsiveness spends attributed CPU, never elapsed silence
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/cdp/src/probe.ts
---
A silent CDP command cannot distinguish a descheduled renderer from a busy one. A responsiveness verdict therefore counts cumulative CPU on the same attributed renderer process while that command remains unanswered; each sample counts at the share the caller names — none during an engine pause or an open dialog, `1/F` under a CPU slowdown of factor `F` — and a missing sample, process replacement or counter reset makes that flight unprovable. Without attribution, the original command waits for its answer or session end and remains cancellable. The cadence schedules observations; wall time never spends the budget. The slowdown share exists because Chromium's POSIX [CPU throttler](https://github.com/chromium/chromium/blob/152.0.7977.167/third_party/blink/renderer/platform/scheduler/common/thread_cpu_throttler.cc) slows a thread by spinning it in a signal handler for `F−1` times each slice it ran: the throttled renderer burns full CPU while doing `1/F` of its work, so counted whole it reads as a hang: the Linux desktop host refused the shared conditions scenario `page-unresponsive` 7 s into it, during — by its timing — the 6-second loop it runs under a ×20 slowdown.

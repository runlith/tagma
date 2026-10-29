---
id: 01a15be3-e024-7896-9700-200e87d00603
title: "The permanent CPU sampler is off by default in every build: a stall's frame serves whoever debugs, and every installation pays the price"
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/performance/layer.ts
  - kind: file
    ref: packages/performance/src/CpuProfiler.ts
---
The permanent sampler is needed for one thing only: so that a loop stall that already happened carries a code frame — no profile can be taken retroactively. That benefit goes to whoever debugs Tagma performance; the price is paid by every installation: fractions of a percent of a core at idle and, on JSC, SHA1 of the whole source for every first-sampled function — GC pauses of hundreds of milliseconds and seconds at server start ([[8c935cbb]]). So the sampler is off in every build and is enabled with the `telemetry.cpuSampler` setting for the duration of debugging.

Until the first permanent or manual window the sampler does not attach the inspector Session. A refusal to enable the profiler or set the interval leaves the window closed; the next window repeats the setup, because attaching a Session does not yet mean the profiler is ready. In Bun, disabling an attached Session stops the whole isolate's profiler even if that Session never started recording, and destroys the external measurement. Enabling the setting opens a window within a second; disabling closes it at the next window change. The stall is still recorded with everything but the frame: latency, process and loop-thread CPU, memory, spans across it. A manual capture opens the sampler for its own window itself — without that, `capture_performance_profile` with the setting off would answer "the process runs no profiler".

---
id: 01a1237b-9bc0-7dad-8ebb-bac4f4a3f7bb
title: Inspection-worker phases mirror into main-process spans as they happen, not forwarded after the answer
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/phases.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/workers/waits.ts
---
The worker has no telemetry storage of its own, so its work is only visible through the main process. The worker tracer reports each `inspecting.*` span open and close to the queue, and the queue immediately creates the matching span at home, under that request's `inspection.worker`.

- **Why live, not batched after the answer.** `PerformanceTracer` places a span where it was created: start and position come from main-process clocks at that moment. A span sent afterwards would land at the end of its parent, and the breakdown would count time wrong.
- **The queue knows the phase even when the worker is silent.** The open event leaves before synchronous computation. So a worker that computes and can't answer a state question is still named in the log together with the phase and its duration.
- **Only phases mirror.** Git spans and other internals aren't forwarded, and their time counts inside the phase they ran in. Otherwise one landing with a dozen rules would exceed the budget the storage keeps for one operation, and lose exactly these details.
- **A phase unclosed at the request's end** (worker stopped, request interrupted) closes in the main process as interrupted.

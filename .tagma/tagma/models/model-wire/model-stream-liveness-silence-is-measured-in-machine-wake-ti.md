---
id: 01a107e8-7bef-7f67-a8fc-92a3556861ee
title: Model-stream liveness silence is measured in machine wake time, not wall-clock time
ord: 32
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a10553-8e46-717c-8cd5-4323da4bac13
sources:
  - kind: file
    ref: packages/llm/src/llm/route/liveness.ts
---
The silence watchdog counts the window only while the machine is awake and while the pull to the transport is pending; a slow consumer does not consume the window.

Wall-clock time (`Date.now()`) and Bun timers run through macOS sleep, so a deadline on them expires at wake for every open stream at once — `StreamStalled` without a single second of real provider silence. `Clock.monotonicTimeNanosUnsafe()` in Bun (`process.hrtime` and `performance.now()` read the same timer) stands still during sleep: in the 2026-10-04 incident a vitals interval 920 s long by wall clock took 1.9 s by monotonic clock. So the deadline lives in monotonic time, and a fired timer only re-reads the remainder and sleeps again.

`Stream.timeoutOrElse` from Effect 4.0.0-rc.110 measures by `currentTimeMillisUnsafe()` and does not fit here.

Cost: a connection that died during sleep is discovered by a TCP error or by the window accumulated after wake, not by the wake moment itself.

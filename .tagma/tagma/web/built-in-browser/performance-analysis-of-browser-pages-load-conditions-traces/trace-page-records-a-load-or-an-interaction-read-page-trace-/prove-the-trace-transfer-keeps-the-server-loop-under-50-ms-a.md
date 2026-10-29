---
id: 01a18547-5d06-7e98-8782-162e1411e8b9
title: Prove the trace transfer keeps the server loop under 50 ms, and measure desktop input lag during it
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a184dc-4fbe-7b01-a2d5-4fae5c99a890
---
The server's one-sample acceptance criterion is proved below. Desktop window input lag during a large trace transfer is the only unfinished part: it requires Electron, which this run was instructed not to launch. Leave this task open for that measurement. The server result is one sample, not a guarantee across machines or load.

On 2026-10-29 at 03:26:11.652–03:26:19.654 UTC, a retained rig drove `trace_page load`, then `start`, six evaluations generating 100,000 Performance marks each, `stop`, and `read_page_trace` through the managed engine operations. Machine: Apple M2 Max, 12 logical CPUs, 32 GiB RAM; Bun 1.4.4; Chrome for Testing 151.0.7922.71; checkout HEAD 4e86fbee9d1c000fa2c77ce97fad9465db1bb15b, with concurrent browser work in the shared checkout. The machine was not quiet: the end-of-window load averages were 5.59/29.18/63.10.

The trace was 136,675,397 bytes uncompressed and 8,085,485 bytes gzip, with `dataLoss: true` after filling the 64 MB buffer. During the 8,002.082 ms stop/transfer/analysis call, 1,470 five-millisecond timer observations had worst lateness 9.016 ms. `LoopStalls` at a 50 ms ceiling recorded no stall. `CpuProfiler` retained a profile spanning the whole transfer and analysis, so no over-50 ms interval needed attribution in this sample. `Traces.collect` took 6,423.615 ms and `Traces.analyze` 1,562.743 ms. The analysis returned no insight sets for this buffer-filled mark-only recording; the regular trace scenarios separately exercise insight content.

Peak RSS of the measuring process, including its worker isolates, was 683,329,120 bytes (651.67 MiB), from 115,114,896 bytes before the stop. This is an upper bound for memory resident while the analysis worker ran, not worker-only RSS: Bun workers share a process. A separate analysis-worker heap high-water mark was not instrumented.

The rig, tick report and raw CPU profile are retained in the scratch of thread [[01a185ad-5db5-78c2-b24b-f3953d460422|trace-lag]] as `trace-lag.itest.ts`, `sample-1.json` and `sample-1-a3946753-0d4a-4c21-8ec3-a657330b3422.cpuprofile`. The gzip byte count was read while the test root still existed; testbed removed that root before the trace could be copied, so the original gzip file is not retained. No production change was indicated by this measurement. The four earlier unprofiled samples (12/10/62/196 ms on the same CPU family under much heavier load) remain unattributed and are not explained by this later sample.

The required whole `managed-browser/engine.itest.ts` and `screencast.itest.ts` run on seed 1 had 23 passes and 13 failures in the shared checkout. All three trace scenarios and all screencast scenarios passed; the first failure was the concurrently edited CPU-hung-close scenario (`scenarios.ts:470`, expected true, received false), followed by twelve `page-unresponsive` failures on its poisoned shared page. The failure and full output were handed to the renderer-close worker already changing that subject.

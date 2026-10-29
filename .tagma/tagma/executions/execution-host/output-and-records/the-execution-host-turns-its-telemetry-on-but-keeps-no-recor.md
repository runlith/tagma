---
id: 01a0d857-53f9-73f5-a522-176b1070a44e
title: The execution host turns its telemetry on but keeps no record, and no operation reads host profiles
ord: 15
tags: ["reflection"]
fields:
  {
    "actual": "`packages/execution-host/src/main.ts` passes `telemetry: {}`, and `hostTelemetry.ts` arms a 15 µs span floor and a profiler window. Yet the host's `performance/segments/` is empty, `catalog.sqlite` has 0 rows, and `performance.sqlite` was last written on Sep 17. No operation reaches a host profile. The host pays for a profiler thread and a tracer, and its 47–82% CPU could not be attributed to any function.",
    "command": "performance skill + read_performance / capture_performance_profile, aimed at the execution host (pid 42498), 2026-09-25, thread 01a0d842",
    "expected": "The host's CPU is profiled and read the way the server's is: its store holds segments, and an operation reads them."
  }
---
Filed from project `runlith`.
---
id: 01a0d85d-a269-7532-8c9b-48ced2349d64
title: "The execution host's telemetry records nothing and nothing reads it: make the host profilable, then profile its 50–80% CPU"
ord: 54
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d85e-3b44-7caa-a010-e5f8cb3aee4a",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0d857-53f9-73f5-a522-176b1070a44e
sources:
  - kind: file
    ref: packages/execution-host/src/hostTelemetry.ts
  - kind: file
    ref: packages/execution-host/src/main.ts
---
**Reflection 1070a44e, 2026-09-25.**
- `packages/execution-host/src/main.ts` passes `telemetry: {}`, and `hostTelemetry.ts` arms a 15 µs span floor and a profiler window.
- Yet the host's `performance/segments/` is empty, `catalog.sqlite` has 0 rows, and `performance.sqlite` was last written on Sep 17. No operation reads a host profile.
- The host pays for a profiler thread and a tracer, and its 47–82% CPU when busy could not be attributed to any function.

**Do:**
1. Find why the host's store keeps nothing, and fix it at the owner.
2. Give an operation, or the existing performance reads, a way to read the host's profiles and vitals.
3. Then profile the running host and name its top costs by function.

The usage sampler (`ps` plus a machine-wide `lsof` every 1.2 s, about 6% of a core) is known; don't redo it.

**Done when:**
- a host profile is readable through Tagma;
- the host's top CPU costs are named with evidence;
- the claims over the changed code are written.
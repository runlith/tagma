---
id: 01a1926d-6b6b-768e-b5bf-7bc318c1b0f1
title: The macOS usage adapter measures each process's GPU time from the AGX AppUsage registry
ord: 7
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1924b-d739-788a-a166-242a92649f20",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1924a-43e4-7c7c-b5a3-e051940ea00a
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
  - kind: relates
    to: 01a1926c-7cd7-7f72-93b8-d4148f301071
sources:
  - kind: dir
    ref: packages/execution-host/src/posix/macos
  - kind: file
    ref: packages/execution-host/native/src/usage.rs
---
Reading [[8f301071]] measured a per-process GPU source on macOS: `AGXDeviceUserClient` entries carry `AppUsage` (`accumulatedGPUTime` per Metal command queue, nanoseconds) and `IOUserClientCreator` names the pid. The macOS adapter reads it natively through the IOKit registry in the native reader — not by spawning `ioreg`, which cost about 58 ms of CPU per pass — sums it per pid, and fills the usage port's GPU as measured; a pid without an entry is measured at zero only if its creator could own one, otherwise unavailable with the reason. GPU time of a gone client leaves with its entry, which accounting must not read as a negative delta.
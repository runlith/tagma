---
id: 01a192e1-8de2-7e0b-b545-096981a7307f
title: "Linux and Windows usage adapters fill the Load ports: GPU, creation-time precision and the execution container counter"
ord: 69
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
  - kind: relates
    to: 01a1926c-7cd7-7f72-93b8-d4148f301071
---
Load's core and ports are OS-neutral ([[70df78a3]]); only the macOS adapter fills them. When a Linux or Windows host adapter is built, its usage adapter also: measures each process's GPU time — Linux DRM fdinfo `drm-engine-*`, Windows "GPU Engine" counters, both documented and unmeasured in [[8f301071]] — or records that none is readable without privilege; measures Electron's creation-time precision against the kernel start, which the window now sends as an unmeasured 1000 ms there; on Windows, fills the execution's job-object CPU counter. Proof per OS by measurement on that OS.
---
id: 01a1a7ad-bf95-78a1-a4a1-3f1cc642fba6
title: Implement the Linux execution-host adapter
ord: 72
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19eb2-4a56-79d0-9dbd-af67ec98a662",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a1a764-10de-7f61-9e76-e67b44a44563
---
Implement Linux process custody, native I/O and resource accounting behind the execution host's platform ports, so the host and its OS-independent consumers run on Linux with the same lifecycle guarantees. Prove the affected shared contracts on Linux and macOS; report unsupported GPU accounting as a typed unavailable outcome.
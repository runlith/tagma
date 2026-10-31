---
id: 01a1924a-43e4-7c7c-b5a3-e051940ea00a
title: Find a per-process GPU source on macOS, Linux and Windows
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1924b-d798-7fc3-b14a-c6b7e56a1457",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a19236-e2ce-7b34-8015-7c0e70df78a3
---
Step 5 of the spec, its research half: for each OS, name a per-process GPU time source an unprivileged process can read, proven by a measurement where this machine allows it, or record that none exists. On macOS the IOKit per-client GPU time listed other processes but not Tagma's GPU process on 2026-10-31.
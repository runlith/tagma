---
id: 01a12899-93e2-7011-90ae-afe34a736f36
title: Execution holder
ord: 43
tags: ["module"]
fields:
  {
    "id": "holder"
  }
edges:
  - kind: imports
    to: 01a1a809-1932-7465-ace6-6eae3277cc67
sources:
  - kind: dir
    ref: packages/execution-host/native/holder
---
Execution processes must survive the host logic's replacement, so their parent and handle owner is a dedicated Rust process. Its core owns the protocol and lifecycle through a `Platform` trait; macOS and Linux share POSIX custody and succession while their backends own spawning, kernel events and process mechanics. Build composition selects the adapter, and host logic decides what to launch, deadlines and status collection through frames.

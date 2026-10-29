---
id: 01a12899-93e2-7011-90ae-afe34a736f36
title: Execution holder
ord: 43
tags: ["module"]
fields:
  {
    "id": "holder"
  }
sources:
  - kind: dir
    ref: packages/execution-host/native/holder
---
Execution processes must survive the host logic's replacement, so their parent and handle owner is a dedicated Rust process. Its shared core — cycle, execution table, logic frame protocol, logic restart policy, readiness and yielding — makes no OS calls and works through a `Platform` trait; the platform module fills it whole and is chosen at build, and a build on an OS without a module fails. The only module is macOS. What to launch, deadlines and status collection are decided by the host logic through frames.

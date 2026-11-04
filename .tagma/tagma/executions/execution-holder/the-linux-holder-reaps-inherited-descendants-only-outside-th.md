---
id: 01a1a83a-70f8-766c-a71e-8be3950355a1
title: The Linux holder reaps inherited descendants only outside the processes its table owns
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/linux/events.rs
  - kind: symbol
    ref: packages/execution-host/native/holder/src/holder.rs
    symbol: Holder.children
---
As a child subreaper the Linux holder inherits every orphaned descendant of its executions and its logic, and must reap them or they stay zombies. Each child pass therefore reaps the children no record, orphan, launch in progress, logic or verifier names, and the core hands the platform that set from its own table. A list kept by the event queue instead lost exited but unreaped records across an image swap, so the sweep consumed their exit status and the logic's later reap failed.
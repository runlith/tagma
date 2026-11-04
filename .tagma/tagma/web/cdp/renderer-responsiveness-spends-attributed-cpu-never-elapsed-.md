---
id: 01a1a76a-aaa8-7eed-9b33-f9a8e85431e9
title: Renderer responsiveness spends attributed CPU, never elapsed silence
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/cdp/src/probe.ts
---
A silent CDP command cannot distinguish a descheduled renderer from a busy one. A responsiveness verdict therefore counts cumulative CPU on the same attributed renderer process while that command remains unanswered; an engine pause excludes sampled CPU, and a missing sample, process replacement or counter reset makes that flight unprovable. Without attribution, the original command waits for its answer or session end and remains cancellable. The cadence schedules observations; wall time never spends the budget.

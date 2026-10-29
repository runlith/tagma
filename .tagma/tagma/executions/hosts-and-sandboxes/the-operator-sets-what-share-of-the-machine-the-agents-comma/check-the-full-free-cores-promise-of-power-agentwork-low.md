---
id: 01a172fb-aeac-77d3-9f28-4fb757d6ffff
title: Check the full-free-cores promise of power.agentWork=low
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a17013-3f6a-7d64-8f31-d9c350db5e4a
---
Low deliberately sets QOS_CLASS_UTILITY at spawn (`native/holder/src/macos/spawn.rs#child`); Pacing picks the level and follows the tree but sets no CPU quota. The execution error is unconfirmed. The promise of all free cores in `power/keys.ts#agentWork` and the feature card is wider than the mechanism: [Apple describes QoS as an input for P/E-core choice and speed/energy balance](https://developer.apple.com/documentation/apple-silicon/tuning-your-code-s-performance-for-apple-silicon/), and [libpthread puts a utility clamp](https://github.com/apple-oss-distributions/libpthread/blob/main/src/qos.c).

Source records: [[01a16a94-8d3a-7610-abd9-8503665bc41f|measurement thread]], tool records 10950, 10957, 10964, 10976. Over ≈8 s CPU time gives 0.970 / 2.928 / 2.760 / 2.558 cores at N=1/4/8/12; with taskpolicy -b — 0.947. The arithmetic is right. But top was taken by previous separate commands, the load varied, there is no Full control and no per-core placement record. "Utility only on E", the throughput-drop cause, and all the timeouts stay hypotheses; an idle 35% does not equal proven available eight cores.

Recommendation: keep the system utility QoS for Low, drop the full-utilization promise; the price is that the OS may leave part of the CPU unfilled. The operator's question: do we accept Low as a yielding mode at that price, or does full loading of free cores take priority and require changing its mechanism? This revises the accepted promise, so the feature-card text and settings were not changed. The reflection stays unanswered; live checks and new benchmarks were not run.

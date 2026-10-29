---
id: 01a0e532-c82e-7381-8a32-8758a71bb222
title: "Cross-module step: D9 E8"
ord: 39
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-c828-7195-a4be-9fc6f3aa2e7e
  - kind: waits-on
    to: 01a0e532-ccd0-7519-b42c-f1a2fae4395f
  - kind: waits-on
    to: 01a0e532-cd2d-71a0-995a-180e3593792f
---
The tracked task `D9 E8` of §7.2.2 and §7.2.4 ([[f7e0b9dd]]).

Measured in main on 2026-09-28: the store writer's permit wait reached 9–18 s under about 30 working agents, long enough that run heartbeats landed past their 15 s grace. The mixed-load run of D9 includes a heartbeat-latency figure; a heartbeat never waits behind a background writer turn.
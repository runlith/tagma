---
id: 01a1add2-5ff8-7b3a-a45e-bae7adc750e9
title: A migration that drops user data keeps it aside until no installation reads it, and a step back restores it
ord: 2
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a1ad3a-f940-7727-920c-1581a3d3b323
---
A step back must lose nothing a dropping migration removed. Such a migration keeps what it removes aside, released only by the pruning that removes the last installation that reads it, and the step back puts it back. `migration-backs` refuses a drop without that keeping, and rule a3d3b323 no longer lets a comment excuse user data. Build on `platform/store/aside.ts` ([[899da1e8]]) where it fits rather than writing a second mechanism.
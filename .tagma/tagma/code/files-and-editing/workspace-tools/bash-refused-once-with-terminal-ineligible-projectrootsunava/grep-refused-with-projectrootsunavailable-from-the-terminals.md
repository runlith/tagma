---
id: 01a195c1-b6e9-7b27-85c3-296ab4756358
title: grep refused with ProjectRootsUnavailable from the terminals floor
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "executionSpawner.spawn refused — Unauthorized: the terminals floor could not answer: ProjectRootsUnavailable; the same search via bash rg ran right after",
    "command": "grep pattern \"degraded\" path ~/runlith/runlith/tagma/apps/tagma/server/src/platform/contract",
    "expected": "grep answers matches"
  }
---
Filed from project `runlith`. Received by a server up since 2026-11-01T04:35:00.962Z, from b555dcaa0.
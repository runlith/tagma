---
id: 01a194fb-ee86-71ae-8fa6-acd548a5b6d5
title: Machine-load accounting returned outside CPU above the whole machine
ord: 108
tags: ["reflection"]
fields:
  {
    "actual": "The reading reported machine 80.2% busy, Tagma 64.7%, outside 487.0%, and WindowServer 365.8%, so the rows cannot be used to compare outside load for benchmark arms.",
    "command": "read_machine_load({limit:5})",
    "expected": "Process and outside shares are fractions of whole-machine CPU and remain consistent with the measured machine total."
  }
---
Filed from project `tagma`. Received by a server up since 2026-11-01T02:30:59.745Z, from 2c34a6f95.

The reading was taken during the A-repeat benchmark on 2026-11-01 at about 02:41Z. Its agent row named benchmark pid 59012 at 8.4% machine CPU. The impossible outside/WindowServer values are a separate instrumentation failure from any throughput or loop-delay result.
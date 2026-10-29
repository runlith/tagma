---
id: 01a0de31-d6f5-7107-8c25-55c70bb4b564
title: A capture holds its asked window against the standing rotation, and its answer names what cut it
ord: 36
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0de28-0af5-735b-a8eb-bade04dc0b11",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d857-52e4-73c6-b7dd-01048939d884
sources:
  - kind: file
    ref: packages/performance/src/CpuProfiles.ts
  - kind: symbol
    ref: packages/performance/src/CpuProfiler.ts
    symbol: make
---
Reflection 8939d884: three 30 s `capture_performance_profile` requests on the server answered profiles of 3.7–4.9 s — the standing rotation (the server's window is the 5 s vitals interval) fired inside each capture and threw the earlier samples away, and `requestedDurationMs` stored the shortened length, so nothing said it happened (claims 049d1e47, 5005a82c).

**Do:** while a capture's window is open the standing rotation leaves it alone; a stall may still cut inside it and keep its freeze. The stored record keeps the asked length as `requestedDurationMs`, its bounds the covered one, and the capture's answer names the profiles another request kept out of the asked window. The model-facing answer is a receipt, never the whole artifact.

**Done when:** a capture longer than the standing window covers its asked length; a stall inside one is named in the answer; the claims over `CpuProfiler.ts#make` and the capture door are rewritten.
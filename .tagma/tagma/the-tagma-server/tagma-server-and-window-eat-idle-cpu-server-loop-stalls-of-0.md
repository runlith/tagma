---
id: 01a1362d-a0db-7666-88df-6b9d95a079fc
title: "Tagma server and window eat idle CPU: server loop stalls of 0.1–3.7 s, 1.2M dropped spans per session, window at 20–25% of a core"
ord: 119
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1362d-c08b-712a-a1c9-e92ecde18ee6",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13616-a718-7223-86c3-78cd69b7211d
---
Tagma eats CPU and stalls its event loop even when its own work is small. Measurements of 2026-10-13 on the operator's machine (12 cores), install `20261013T135707182Z`:

- **Server** (pid 64146): 24 min 22 s CPU over 2 h 30 min of life, i.e. about 16% of a core on average; at measurement moments — 22–57%.
- **Server loop stalls:** 16:09–16:13 UTC — 10 stalls of 0.7–3.7 s. 16:20–16:26 UTC — about twenty of 100–400 ms, all inside `agent.model-step` and agent tools. Stall profiles are coarse: 1–3 samples per hundreds of ms. At the top of profile 18e24e1b — `PerformanceTracer.end` (852 ms), send into sqlite-process (828 ms) and `platform/watch/tree.ts` `listen` from `graph/serving/freshness.ts`. No cause established by this.
- **Telemetry:** 1,200,215 records dropped over the server session, of them 1,155,116 spans (`read_performance` profiles: `sessionDrops`).
- **App window:** Electron renderer (pid 13206) — 20 min 49 s CPU over 3 h 25 min, about 10% of a core on average; at measurement moments — 19–25%.

To do: find what the server and the window spend CPU on and why the server loop stalls, and remove the causes at their owners. If stall profiles cannot name a frame, fix the tool itself, because 1–3 samples per stall explain nothing.

Out of scope: the execution host sampler pass (task [[69b7211d|Load rework]]) and worktree merge checks ([[0d2fb993|merge check]]).

Proof: measurement before and after under the same load — idle CPU of server and window, count and length of loop stalls, dropped spans per hour.

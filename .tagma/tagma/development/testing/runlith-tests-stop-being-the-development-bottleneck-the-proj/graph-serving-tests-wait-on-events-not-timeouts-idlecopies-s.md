---
id: 01a16fbd-b526-7686-af37-d803222bb766
title: "graph serving tests wait on events, not timeouts: idleCopies, servingDrill, lanes, farEdges, copiedBlocks, baselineRace, writeThrough, levelling, platform/store/baseline, composition place"
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16fbe-75d1-7e7b-8344-8367b168014b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16ac4-44bf-7e0a-8178-b6ff38ef1770
  - kind: relates
    to: 01a16fbd-b4fa-7f3d-8686-f6122255f40d
---
Graph serving files run 24–42 s wall at 9–21 s CPU and fail in a parallel test:all on the 10-second timeout while passing alone. Find what each test waits for and wait on the owner's event; logic a file verifies through a whole world goes to unit under [[4dbd9a84]]. Acceptance: wall and CPU before and after, green on seeds 1–3 and next to parallel load, no raised timeouts, no skips. Total 2026-10-24: 31 tests in 10 files green, each file verified separately on seeds 1–3; joint check at load average 17.74 — 31.9 s wall and 77.9 s CPU against the original 44.0 s and 96.3 s with two timeouts. These are two samples of one command, not an isolated A/B: testbed dealt 10 and 5 workers, the neighbor task's world changes applied after. Polls replaced with FileWatcher.settle and Remeasure.ready; the joint copy preparation kept in the template, baseline verified on a narrow real SQLite chain; timeouts never raised, no skips added.

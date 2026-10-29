---
id: 01a16ded-f846-706f-be0a-55b0fb54f4ff
title: Cheapen the thread-transport parity and terminal tests
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-9175-7310-be64-e74945295153",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
---
20 parity*/terminal* files dissected: 9 deleted or merged, 7 cut down, 4 left on hooks, lease, guidance and PTY boundaries. All 7 changed files passed seeds 1, 2, 3 separately: 63 tests green. Source package CPU — 265.1 s; the sum of first new single runs plus the prior cost of 4 untouched files — 129.2 s (2.05x), but these are indicative measurements under load with 7 cold worlds, not a quiet shared run. The quiet cost of the shared set is still unmeasured. Outcomes and covering tests — x10/x-transport-a.tsv in the orchestrator's scratch.

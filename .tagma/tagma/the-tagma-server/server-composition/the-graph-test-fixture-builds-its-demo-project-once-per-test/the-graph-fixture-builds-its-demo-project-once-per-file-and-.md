---
id: 01a0d55a-eaac-7d51-922a-487f6c2fa335
title: The graph fixture builds its demo project once per file and opens each test on a copy of that state
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d55b-67fe-703d-9592-aac4198509a9",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0d556-c247-7d1e-b72c-3ae909744317
---
Build [[09744317]] in its order:
1. Measure the per-service construction cost, and whether any graph state lives outside the store.
2. Build the per-file template and the per-test copy.
3. Make lazy, at their owners, the startup reads the measurement names.

**Done when** acceptance §7 holds, with the before-and-after figures in the close, and the decision is closed into the claims its truth now stands on.
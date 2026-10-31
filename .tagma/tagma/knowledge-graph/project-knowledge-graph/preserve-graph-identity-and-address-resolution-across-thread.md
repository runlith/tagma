---
id: 01a1941f-f2bb-77f3-9717-654dea161cff
title: Preserve graph identity and address resolution across thread copies
ord: 262
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a0e8af-1e11-745f-825a-639a45ed43fe
  - kind: relates
    to: 01a12c8b-92e6-7ee7-9b2b-f9ef3751ed77
  - kind: relates
    to: 01a12cad-06a8-7ae6-89b4-136c2477ffa3
---
Reproduce the original parent-child-grandchild graph lookup with its home and worktree, and investigate the reported mirror-repair identity loss at the deletion producer. Correct a current contract breach without introducing a new recovery feature or manually restoring shared graph files. Work alongside the existing large-block edit investigation, recording separate evidence and verdicts for each report.
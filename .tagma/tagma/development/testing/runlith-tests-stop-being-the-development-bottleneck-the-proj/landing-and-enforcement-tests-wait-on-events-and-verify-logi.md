---
id: 01a16fbd-b520-7f75-9f78-608dc2e37b02
title: "landing and enforcement tests wait on events and verify logic at the owner: place, commitGate, submitGit, steps, mergeHome, configTightening, remeasure, heldDebt, approver"
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16fbe-7640-70b1-b2ea-d818d3b7abfd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
  - kind: relates
    to: 01a16fbd-b4fa-7f3d-8686-f6122255f40d
---
These files are the slowest and costliest in git (place and commitGate at 67 s wall each, ~39 s of it waiting) and do, through a whole world, what makes `check:change` select them on nearly any server change. Each gets an outcome under [[4dbd9a84]]: logic — to unit at the owner, boundary — to narrow itest, junk — deleted; waits — on the event. Acceptance: each file's wall and CPU before and after, green on seeds 1–3 and next to parallel load, `check:change --plan` share on the same landing and enforcement commits before and after; no raised timeouts, no skips.

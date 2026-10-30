---
id: 01a12595-90c3-71f4-a8b9-dcb98695c8f0
title: "Index sync after landing holds no index.lock between reading the index and git reset: an external git add in that window is wiped out"
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15ea-7e36-afbb-1304efaca0fa",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12582-fbf7-755e-8fd0-98c0a4db449b
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/indexSync.ts
---
Found by reviewing the fix [[a4db449b]]. `syncIndex` in `landing/land/indexSync.ts` reads the index, decides which paths to pull into the commit, and then runs `git reset`, but holds no real `index.lock` across that window. An external `git add` finishing between the read and the reset is silently wiped out. Fix at the owner: hold the lock across the whole window or compare the index entry atomically before replacing. Done when an integration test with a `git add` inside the window shows the staged version survives.

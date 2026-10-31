---
id: 01a193d9-9a1f-79e8-9f71-7a984d16c47c
title: A module from another root keeps its own store and migration chain
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: implements
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
  - kind: waits-on
    to: 01a193d9-9a1f-79e8-9f71-7a97bd02efd7
---
Item 7 of [[0ac072c1]], on the precedent of `packages/activity` and `packages/performance`. A build that lacks the module opens a data directory holding its store and keeps working.
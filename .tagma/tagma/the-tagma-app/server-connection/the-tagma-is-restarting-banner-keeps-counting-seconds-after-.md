---
id: 01a151d7-0514-7baa-8ad6-ce319c5892b3
title: The "Tagma is restarting" banner keeps counting seconds after the server is up, and survives page reload
ord: 2
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a151cd-c1e3-7205-b318-fbf3f76a8a50
---
Found while verifying f76a8a50: after restarting its own tagma:try, the restart banner never left, the counter kept counting past server rise, and survived page reload. Find what holds the restart state (and where it persists across loads), and why a live server never clears it.

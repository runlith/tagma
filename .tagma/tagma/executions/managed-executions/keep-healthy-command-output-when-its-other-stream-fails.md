---
id: 01a1941f-f2bb-77f3-9717-6549e39a6a46
title: Keep healthy command output when its other stream fails
ord: 107
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193f6-f75f-7249-8b8f-36444a9361c0",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a12889-c950-77d9-8c83-8e7d8b2c2da3
  - kind: relates
    to: 01a1354b-d25f-781a-bf7b-29c639e8b6e1
  - kind: relates
    to: 01a14055-c916-7d7f-b8c0-c50da2994983
  - kind: relates
    to: 01a14652-48dc-7196-8d84-c42b8fd6b50c
  - kind: relates
    to: 01a14cdf-fbdd-7498-a21f-cd60b62892a3
  - kind: relates
    to: 01a19414-3450-7586-b2b1-a1510f6f108c
---
The public bash regression reproduces a stdout CommandUnreadable (the historical HostRefused projection), a real process writing stderr, and exit 1. ShellRun.collector failed fast across both streams, cancelling intact stderr; it now collects their outcomes independently and reports the original partial-output failure after both finish. The HostRefused subtype from the original record is absent, so its subscription producer remains unproved and no retry or recovery was added. Historical short-command handoffs all had an unread owed report before launch: google inventory report 20:05:00.997Z versus bash 20:05:13.693Z, git diff 02:36:15.309Z versus 02:36:54.088Z, and search 16:10:42.895Z versus 16:10:45.042Z. Their foreground yield is the standing policy, not wait expiry; current bash tests distinguish ended, queued and unreadable process phases from observation lifetime. The exact sleep 280; echo waited scenario is now refused as sleeps-only through public tool preparation, and the owed-report yield test passes. The terminal selector report reached a server running since 17:51Z, while dfd6a462ad landed at 22:04:47Z: its offered schema lacks project, unlike current source and the prior native-door regression. No working server was changed. Each reflection keeps its own verdict; the underlying HostRefused cause remains open.
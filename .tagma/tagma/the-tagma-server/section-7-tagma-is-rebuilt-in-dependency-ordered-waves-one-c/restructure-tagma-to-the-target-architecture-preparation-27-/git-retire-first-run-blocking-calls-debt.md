---
id: 01a0e913-bd23-792f-a565-14108d6207d4
title: "git: retire first-run blocking-calls debt"
ord: 84
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e81f-2378-7ab1-9fa4-92622528a8c5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0e569-e621-72f5-9ecd-6129055c5c72
  - kind: implements
    to: 01a0e470-f876-7433-b54b-0ba8e4a0488f
---
Retire the 1 blocking-calls synchronous I/O site recorded for packages/git in checks/blocking-calls.server.debt.json. Keep the serving isolate non-blocking and prove the changed reach is clean.
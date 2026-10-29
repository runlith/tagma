---
id: 01a16024-2da2-70f0-8b18-3ec6018ec548
title: "ACP: restore compaction on the turn boundary"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16023-ba88-7954-9f0f-f8f65415922c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24da026af37c
---
Find the cause of protocolMethods failing on compaction inside a turn from code/history, fix it at the owner, and confirm with a public system test.

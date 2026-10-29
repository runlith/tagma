---
id: 01a16184-5c80-7407-9b31-a69b98fbbf10
title: Drop held debt after deleting an uncommitted file
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16183-e02a-7826-955a-66be3cbeab9c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a16183-c7b4-7395-90cb-d65d0344810b
---
Fix the standing held-debt definition at the enforcement producer: a file deleted before its first landing no longer holds debt. Check the public contract with a minimal test and typecheck; check the live graph after the server update without a restart in this work.

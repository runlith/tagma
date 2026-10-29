---
id: 01a155c1-9dc2-7282-9be8-0a354a19212c
title: Task names in the commit subject stand exactly once
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a155c1-4c49-7d40-9b28-f93a772904c2",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a155be-2f10-798f-b4a3-c7d20c5bbe70
sources:
  - kind: file
    ref: apps/tagma/server/src/landing/land/message.ts
---
Fix the submit_work message assembly: task names already at the end of the subject aren't repeated, missing ones are added, the message body is kept. Start with landing/land/message.ts; align the commit instruction and the submit_work description with this fact's owner. Proof is a narrow check of the landing result and the fix commit; task choice across checkouts isn't in this work.

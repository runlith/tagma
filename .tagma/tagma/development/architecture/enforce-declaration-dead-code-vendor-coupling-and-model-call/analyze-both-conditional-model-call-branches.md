---
id: 01a18e91-b9ed-7b5d-9bea-92b22694030f
title: Analyze both conditional model-call branches
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18e91-0057-7f4b-85b6-a35adafffddb",
    "status": "in_work"
  }
---
The calls analyzer short-circuits a conditional's false branch when its true branch yields a capability (`checks/law/architecture/calls/file.ts:774–777`). Prove the missed call with a red fixture, then analyze both branches.
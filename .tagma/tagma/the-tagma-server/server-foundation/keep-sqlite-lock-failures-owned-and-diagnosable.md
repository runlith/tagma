---
id: 01a1941f-f2bb-77f3-9717-65501dc70298
title: Keep SQLite lock failures owned and diagnosable
ord: 40
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19421-dd90-73db-9615-8771d5cafaa8",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a131f9-1a04-7cf7-ab30-68f847835745
---
Reproduce the archive-bench SQLITE_LOCKED shutdown in an isolated test fixture, retain the failing statement and typed cause, and fix any current connection or writer lifecycle defect at its owner. Never stop or replace the working server and do not turn a lock failure into silent success, a blind retry or a relaxed deadline.
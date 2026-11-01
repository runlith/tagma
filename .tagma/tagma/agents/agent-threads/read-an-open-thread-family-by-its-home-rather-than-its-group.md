---
id: 01a19880-a0a5-7b28-92af-e8c38d1b9cbd
title: Read an open thread family by its home rather than its group tile
ord: 35
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1987e-3f31-77df-abb9-68da18aab582",
    "status": "in_work"
  }
---
The app now reads an open thread's family by thread ID without an explicit project, so the server resolves its home rather than the column's group tile. The grouped-column regression exercises ThreadList, ThreadsRepo and the HTTP Door over a transport double enforcing the existing project contract: it failed before the fix with the reported 45-versus-5 place-mismatch and passed afterward. All 44 selected list tests passed; the changed file passed alone with shuffle seeds 1, 2 and 3. App typecheck passed with no errors and two warnings outside the changed files.
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
Fix the app's family read for an open thread in a grouped agent column: the dock tile is not the thread's home, so sending it as the explicit project produces place-mismatch. Resolve the family through the thread subject and prove the grouped-column path fails before the fix and succeeds after it.
---
id: 01a18a3e-8307-75ca-ad66-222615b36fe5
title: Preserve pre-existing literal handles during batch edits
ord: 251
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15eb-7a51-a5e5-7575ca9c9ee7",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a1825a-e506-7718-80d2-47cac502b134
---
Fix apply_batch rewriting of existing literal handle references so an unrelated edit preserves the stored body while newly introduced unresolved handles still refuse. Prove the reported edit through the native tool door before and after the fix.
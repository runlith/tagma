---
id: 01a1ae21-c4ce-741e-a10c-835a83e47543
title: Going forward again after a step back, a module store re-adopting a moved table takes what the person changed on the previous installation
ord: 53
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1ace6-ac40-7866-b9c1-ffdac5137949",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a195b9-c52c-7da9-a023-4462899da1e8
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/aside.ts
---
After a step back, the previous installation edits, adds and deletes rows of a moved table in the machine store. Going forward again, the migration sets them aside afresh and the module store adopts them with `ON CONFLICT (key) DO NOTHING`: its own rows from before the step back win, edits made on the previous installation are dropped, and rows deleted there come back. The re-adoption has to tell rows the set-aside holds newer from rows the module wrote itself before adoption landed. Done when a back-and-forward round keeps the previous installation's edits and deletions of a moved table.
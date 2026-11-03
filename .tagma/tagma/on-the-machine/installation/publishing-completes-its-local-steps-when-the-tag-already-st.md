---
id: 01a1a2be-316b-7df6-963d-8b104acbba52
title: "Publishing completes its local steps when the tag already stands: maps are kept atomically before the tag, and a tagged HEAD without kept maps is finished, not answered as released"
ord: 88
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1a2bb-33ee-76fa-bb2d-1d7445b0686d",
    "status": "in_work"
  }
edges:
  - kind: implements
    to: 01a1a21e-4549-7e66-ad45-d4a4f405abcc
  - kind: relates
    to: 01a1361b-0306-7539-b5f1-3cd46c675b20
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/cut/publish.ts
---
The tag was created before the source maps were saved, and `ship` answered a tagged HEAD as released, so a stop between the two lost the maps once the next cut removed the cut directory. The maps are copied beside and renamed into place before the tag; `ship` on a tagged HEAD whose standing cut is of that release and whose maps are not kept goes on to publish, which takes up what stands and completes them.
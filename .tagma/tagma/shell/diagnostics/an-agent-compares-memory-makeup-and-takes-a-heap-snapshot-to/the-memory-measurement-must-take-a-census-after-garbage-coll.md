---
id: 01a14c37-8e59-7f51-83ea-bf7455a6d4e5
title: The memory measurement must take a census after garbage collection, as the description promises
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a14c05-9e8f-7c75-a633-b2b2e5442353
---
The grammar promises GC before census, but `MemoryCaptures.ts#takeMainMemory` takes the source reading before GC and keeps the second one separately; `reports/memory.ts#growthOf` compares the source ones. Bring the code and the description to one.

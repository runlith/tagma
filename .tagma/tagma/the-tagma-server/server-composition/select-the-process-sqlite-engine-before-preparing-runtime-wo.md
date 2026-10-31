---
id: 01a191fa-a0c7-7635-b81a-3d8d98732419
title: Select the process SQLite engine before preparing runtime workers
ord: 41
tags: ["task"]
fields:
  {
    "holder": "tagma:01a191f6-b674-739d-a728-5606b8cf1fc7",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a127c8-442b-7600-9d5b-c533114f680f
---
Fix startup order so Bun workers cannot select the system SQLite before activity storage and graph readers select the supplied engine. Reproduce the failure in a fresh process through runtime preparation, performance storage and activity storage; preserve existing data and source-identity enforcement.
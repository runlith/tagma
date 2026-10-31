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
Bun shares SQLite engine selection across Worker isolates. A telemetry worker opening first selected system SQLite, after which activity storage and graph readers refused its source identity. Composition now prepares and selects the supplied engine before worker preparation and cold runtime assembly. The fresh-process test through PREPARATION, a real telemetry read, and an activity write/read failed with the reported source mismatch before the fix and passed seeds 1, 2 and 3 afterward; server typecheck passed. Existing data and source-identity enforcement are unchanged.
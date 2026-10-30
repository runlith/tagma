---
id: 01a18a48-84e3-728e-9ce2-92eed49b287f
title: Resolve same-project references in the graph copy being written
ord: 254
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18a3c-15eb-7a51-a5e5-7575ca9c9ee7",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a18515-0ded-79a8-9dd8-ba593440a852
  - kind: discovered-from
    to: 01a1851c-1e9c-7089-875e-6f7ce8976414
---
Keep row numbers local to their graph copy when create, move or link resolves another reference. Rebind resolved UUIDs in the writing copy and refuse a missing parent or origin instead of using another copy's unrelated row number.
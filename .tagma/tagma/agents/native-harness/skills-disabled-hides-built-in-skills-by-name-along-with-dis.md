---
id: 01a12cb2-7923-76b0-9ef0-6da4fa54f1d1
title: skills.disabled hides built-in skills by name along with discovered ones
ord: 8
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c86-94f7-747f-9d9d-8b4f062231df",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0fecc-1292-7da8-a266-476aa17d0573
sources:
  - kind: file
    ref: apps/tagma/server/src/native-harness/contract/service/inputs.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/operations.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/inputs/walk.ts
  - kind: file
    ref: apps/tagma/server/src/native-harness/skills/pool.ts
---
WorkspaceInputs carries the skills.disabled exceptions into the shared skill pool: catalog, loader, and inventory use one policy for built-in and discovered skills; an empty pool removes the catalog and tools. With artifacts off, showcase renders a page into scratch. Draft and thread catalogs, saving the current run's snapshot, disabling and restoring tools and the stored world state, read/reload inventory, and a built-in name collision through an installed CLI of its own tagma:try are verified. Narrow tests and typecheck are green; Sol and two Muse confirmed findings fixed.

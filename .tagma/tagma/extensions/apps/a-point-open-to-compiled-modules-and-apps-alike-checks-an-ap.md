---
id: 01a194fe-7e36-77aa-99ee-01cb5f7ad9a0
title: A point open to compiled modules and apps alike checks an app's claims against the compiled entries' ids
ord: 20
tags: ["idea"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/contribution.ts
  - kind: file
    ref: apps/tagma/server/src/tagma-apps/registry.ts
---
Compiled entries are checked for conflicts in `checkManifests`, app claims in the apps registry, and neither sees the other. While every app point is app-only this is complete; a point given both a typed face and an app face would let an app claim a key a compiled entry already holds. The question is the one rule such a point keeps — most likely the registry refusing a claim on a compiled id — and it is decided when the first such point is wanted.
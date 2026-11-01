---
id: 01a194fe-7f36-7c22-8073-af18678b5b3a
title: A creation step's requirements go unjudged, so add_project's body and its machine-place guard see unknown
ord: 266
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
    ref: apps/tagma/server/src/graph/contract/service/creation.ts
  - kind: file
    ref: apps/tagma/server/src/platform/contract/service/contribution.ts
---
A step's requirement channel is `unknown`, so `add_project`'s body requirement is `unknown` too and its machine-place guard in `pair` passes vacuously. Judging step needs the way `serverParts` judges lifetime needs requires the item type to survive `ContributionPoint.of`; until then a step reaching a service its tier lacks fails at run time instead of at type level.
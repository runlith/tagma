---
id: 01a0cab3-b86a-74ae-8153-a0f8fcf163d1
title: Same-name and same-identity registrations refuse inside the registration unit, beside the insert
ord: 6
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/projects/registration.ts
    symbol: projectsLayer
---
byName and identityFree read through the unit the insert lands in, so no outside read can race a concurrent add: the second lands on the check, not on the unique index. The construction is what a same-name-twice test would prove.
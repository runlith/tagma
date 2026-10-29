---
id: 01a0f536-884b-7a14-ad5e-fcf163ab5550
title: Prove shipped vocabulary neutrality with contradictory workflows and a no-code project
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0f537-da9e-7e32-9eb3-2780318bae7b",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e0cb-0087-794e-be47-9dc36bf40362
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/testing/graph/vocabulary/neutrality.stest.ts
---
Implement the system-test acceptance of [[6bf40362]] §7: two contradictory catalogs use the same engine while their own work lifecycles remain distinct, and a project without code uses the system library without activating code checks. Exercise shipped public operations on isolated fixture data with real registered contracts and installed profiles, asserting outputs, state and typed refusals. Reuse current system-test infrastructure, keep each file within 60 seconds and at most three explicitly configured workers, and coordinate producer defects with their existing owners rather than duplicating implementations. The format integration fixtures remain owned by [[3d39abda]].
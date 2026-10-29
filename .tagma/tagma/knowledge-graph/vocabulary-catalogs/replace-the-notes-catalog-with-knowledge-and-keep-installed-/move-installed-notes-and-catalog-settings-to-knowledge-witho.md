---
id: 01a15a0f-1b49-7a65-a877-b8f9493cad5d
title: Move installed notes and catalog settings to knowledge without losing local types
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15a0e-2b6d-7a45-a5d2-5fa30063c8b7",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/steps/knowledgeNames.ts
---
Add a one-time translation of the machine graph.catalogs setting and a graph step before the installer: keep person/meeting UUIDs and keys, carry permanent references, keep former note/recipe as project declarations, and keep local edits. Proof: a migration-boundary test reading and editing preserved records, typecheck, and independent review.

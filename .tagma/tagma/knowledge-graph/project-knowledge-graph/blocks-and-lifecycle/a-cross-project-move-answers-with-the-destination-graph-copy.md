---
id: 01a196c4-e242-7ea0-97a4-269b83c5b282
title: A cross-project move answers with the destination graph copy
ord: 30
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a19595-c48f-7594-ae00-ef631cc0c227
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/relocation.ts
---
When update_block moves a subtree across projects, the returned block is born in the destination but answer decoration currently retains the source graph copy selected for admission. The feed then addresses the returned block in the source copy. Return the destination provenance from the relocation producer while preserving the source-side journal, authority, transactional ordering and existing name identity. Prove the actual native-door or by-id move response names the destination copy and that both source departure and destination state are correct; include the resumed/idempotent path if it uses a distinct response branch.
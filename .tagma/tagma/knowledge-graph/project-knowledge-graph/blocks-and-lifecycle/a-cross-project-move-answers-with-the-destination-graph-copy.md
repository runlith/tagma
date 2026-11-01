---
id: 01a196c4-e242-7ea0-97a4-269b83c5b282
title: A cross-project move answers with the destination graph copy
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a19595-3043-740f-9cf7-9474573600a0",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a19595-c48f-7594-ae00-ef631cc0c227
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/relocation.ts
---
When update_block moves a subtree across projects, the returned block is born in the destination but answer decoration currently retains the source graph copy selected for admission. The feed then addresses the returned block in the source copy. Return the destination provenance from the relocation producer while preserving the source-side journal, authority, transactional ordering and existing name identity. Prove the actual native-door or by-id move response names the destination copy and that both source departure and destination state are correct; include the resumed/idempotent path if it uses a distinct response branch. The sole independent review of `41f87b257d` found no code regression in destination selection, source authority/departure or either response branch. Its documentation finding was confirmed and [[5af1c386]] now qualifies established provenance and omission of unknown destination copies. New provenance assertions cover serialized normal/resumed two-store moves in main checkouts; shared-store copy assertions and worktree destination coverage remain unproved.
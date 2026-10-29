---
id: 01a1835f-57c9-7da1-a702-7bf1d1622ce0
title: set_block_storage's voice drops the `published` handle, so composition/handles.test.ts is red
ord: 232
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18391-2319-73f8-8a93-18716608a5dd",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18330-e17f-7d9c-8b28-1f66f530957b
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/published.ts
---
`composition/handles.test.ts` fails at HEAD: the `set_block_storage` answer carries `published[]` block names (handles) that its voice never prints, so an agent cannot act on the blocks whose files the repository already committed. The field arrived with a7a76aee. Print each published name in the voice of the operation that owns it.
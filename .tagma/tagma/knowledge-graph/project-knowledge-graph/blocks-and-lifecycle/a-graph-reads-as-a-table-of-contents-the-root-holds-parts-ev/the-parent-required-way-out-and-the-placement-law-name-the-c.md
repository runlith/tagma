---
id: 01a18381-8c01-7142-8c8e-f158593b5a3e
title: The parent-required way out and the placement law name the container owning the code, never a leaf read_owners answers
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18331-30c1-7159-b65f-eebcbaf5a968",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a18330-e17f-7d9c-8b28-1f66f530957b
  - kind: implements
    to: 01a18319-42dc-76d5-8f38-ae98aa192705
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/birth.ts
  - kind: file
    ref: apps/tagma/server/src/graph/sources/ownership.ts
---
`create_block` with no parent and a source on `packages/git/src/history.ts` offered the #explanation and #task `read_owners` answers for the file; following it nests a leaf under a leaf, while the right parent is the Git module card above both. The ways out name, per distinct source, the nearest block supporting core/container whose sources cover it; the law in `graphWriting.ts` and the tag clauses that say "under that code's owner" say the container; `file_reflection` never lands under a leaf it found by ownership.
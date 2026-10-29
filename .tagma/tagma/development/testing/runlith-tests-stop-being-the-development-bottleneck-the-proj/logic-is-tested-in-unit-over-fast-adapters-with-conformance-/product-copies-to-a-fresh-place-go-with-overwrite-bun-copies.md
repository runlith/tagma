---
id: 01a16e9a-8305-743f-a45a-1267fc8c815a
title: "Product copies to a fresh place go with overwrite: Bun copies them natively, not via the slow force:false path"
ord: 37
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16ded-dc27-77a1-99da-993a426871ff",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a16b01-cb85-7e31-9936-47664dbd9a84
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/offer.ts
  - kind: file
    ref: apps/tagma/server/src/graph/serving/open.ts
  - kind: file
    ref: apps/tagma/server/src/graph/storage/move.ts
---
Effect `FileSystem.copy` without `overwrite` passes `force: false` to `fs.cp`, and Bun 1.4.3 takes the slow path: 15–17 ms CPU per copy of a fresh 41-entry git catalog versus 1.3–1.6 ms with `force: true`. Where the destination is provably fresh, `overwrite: true` changes only speed; where it may exist, the copy is untouched — overwrite semantics matter more.

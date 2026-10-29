---
id: 01a140fb-6e90-727f-a34c-d4b613fc905d
title: "Moving a block between graphs in one act: update_block with a parent in another graph keeps the block's uuid"
ord: 56
tags: ["task"]
fields:
  {
    "holder": "tagma:01a140ec-6c7b-7790-9b4d-bc8e91bbd63e",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13aed-fcff-76de-ac35-5802ae2d5ebd
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/blocks/update.ts
  - kind: file
    ref: apps/tagma/server/src/graph/operations/crossing.ts
---
Before this work a block never left its graph: `update_block` with a `parentId` from another graph refused `cross-project-parent`, and `supersede_block` and `link_blocks` refused `cross-project`, because an edge is one store's row. A rule mistakenly recorded in global moved by handwritten copy and `delete_block`, and links to the old block led into the trash ([[ae2d5ebd|reflection]]).

Done: `update_block` with a parent in another graph moves the block there under the same name (`graph/operations/relocation.ts`, the mechanism in [[c82c927b|relocation note]]). A lone block with no edges and no children, in initial status; otherwise `relocation-shape` naming what to drop. The move carries no other edits of the same call (`relocation-shape`); the row checks and snapshot happen inside the leaving act, the sequence is uninterrupted; after review (Sol xhigh) this was fixed by commit 994f084563.

Verified by an integration test in `graphCrossing.itest.ts`: a rule moves from global into the project under the same name, global no longer knows it; a move between same-storage projects passes; a block with an edge refuses and stays put. On the old code the test failed `cross-project-parent`. Not verified: the move on the operator's server (never restarted) and the source graph's behaviour on a later `restore_block` of the trashed copy — it restores as a separate block under a new name.

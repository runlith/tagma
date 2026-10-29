---
id: 01a12cba-d223-7a14-95e0-110e4df246b8
title: Projection undo restores only paths the act touched, and path-prefix selection never reads % and _ as a pattern
ord: 27
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c9f-ec67-7e4f-be87-4300b1d6bd43",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12cae-e6b6-7938-b9ad-8011b023f1ff
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/writeThrough.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
---
`projectDelta` reports every touched path to writeThrough together with its parent directory, and undo after a failed act (`restorePaths`) walks each such directory whole: deleting files missing from the rolled-back DB and rewriting differing ones. So an act failure can overwrite or delete a neighbouring file's outside edit the mirror has not adopted yet. The parent is the ledger's need, not undo's.

Subtree selections in `projection.ts` go through `LIKE '<prefix>/%'`, so `%` or `_` in an imported path become a pattern; length-based `substr` counts UTF-16 from JS but characters from SQLite.

Do: undo restores only paths the act wrote, moved, or deleted; the prefix compares exactly. Proof is red→green tests for a neighbour with an outside edit and a path with `_`.

---
id: 01a12cb6-da14-77e7-84ed-e1b17f692a1a
title: "The projection moves shelf files in two phases: a path is written only after its former owner has left it"
ord: 1
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12cae-e6b6-7938-b9ad-8011b023f1ff
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/projection.ts
    symbol: projectDelta
---
Shelf names are dealt by ord: the bare slug is held by the youngest sibling, so one title change renames others. Moving one by one in row order put a sibling onto a path another block still held: the file was silently overwritten, the directory fell with ENOTEMPTY, and the overwritten file the mirror repair then took as truth and deleted the displaced block's row ([[872121e7|loss reflection]]).

So first all departing members park in `.moving-<uuid>` (the dot hides the parking from tree scanners, the DB path follows it), then take their places. Before writing, the target is freed: a live block outside the shelf parks, and its shelf is processed again; a trash remainder is deleted; live blocks inside a deleted directory are moved out first. A file no block holds is an ExportFailed refusal before the first move: there is no such file in a settled tree, and writing over it would lose someone else's data. Member paths are re-read before every move: moving a directory moves everything inside it.

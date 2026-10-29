---
id: 01a12caf-049c-7406-9bc7-98fa70f08c53
title: Mirror repair rejects a file whose id still stands in another tree file and does not delete a block whose file is overwritten by a foreign id
ord: 25
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
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
`repairMirror` (tree/mirror.ts) checks id repeats only among arriving files. An arriving file with the id of a block whose file on another path is whole and unchanged moves the row to the new path and rolls its text back, while the row standing on the arrival path is deleted for good (`removeBlock`, no trash). That is how the file damage from 872121e7 turned into the loss of 55b5437b and the rollback of 8162ede6. `absorbMirror` (full rebuild) checks no repeats at all.

Decide: a tree with two files of one id is a `duplicate-identity` refusal naming both paths, on both roads (repair and rebuild); the displaced block does not vanish silently. Start with `repairMirror`/`absorbMirror` and `ledger.unreflected`.

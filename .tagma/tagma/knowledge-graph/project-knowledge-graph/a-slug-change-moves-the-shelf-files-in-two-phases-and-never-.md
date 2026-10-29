---
id: 01a12cae-e6b6-7938-b9ad-8011b023f1ff
title: A slug change moves the shelf files in two phases and never writes onto a path held by another block
ord: 24
tags: ["task"]
fields:
  {
    "holder": "tagma:01a12c9f-ec67-7e4f-be87-4300b1d6bd43",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/projection.ts
---
`projectDelta` moved shelf files one by one in DB-row order, while shelf names are handed out by ord. A title change giving the bare name to a sibling moved it onto the path of a block that had not moved away yet: the file was silently overwritten, the directory failed with ENOTEMPTY. Mirror repair took the overwritten file for truth and deleted the block's row at that path (losses 55b5437b and 97fddf44476, doublings 8162ede6 and 92391518, reflections 872121e7 and 0fa91a70).

Do: a two-phase shelf move through parking, freeing the target of an off-shelf block, refusing instead of writing over a blockless file, and parking cleanup in undo. Proof is a red→green test in `projectDeltaMatrix.itest.ts`; the runlith graph is restored with no missing or doubled ids against d4d319297a.

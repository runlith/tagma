---
id: 01a12cce-dcee-72ca-9826-a33562d9a6f4
title: "The graph mirror does not destroy a block: a file gone from the tree takes the block to trash; two files with one id are a duplicate-identity refusal"
ord: 2
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a12caf-049c-7406-9bc7-98fa70f08c53
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/duplicates.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/fallen.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/mirror.ts
---
Tree files are the truth, but a file overwritten with a foreign id (as in a slug collision in [[872121e7|loss reflection]]) is indistinguishable from an edit. So repair and rebuild do not delete the block row but move it to trash with a `delete` event in the journal — `restore_block` finds the batch there. That covers a file deleted from the tree, a block whose path was taken by a file with another id, and on rebuild — every block missing from the scan; the trash standing before the rebuild survives it. Under the rebuild trash the former root hangs under the live root, so restoring it does not yield a second root.

Repair reads every changed path, those git reported deleted included, and only a file absent at that read is gone: the status is a snapshot taken before repair, and trusting its `D` trashed a block whose file stood again by then.

Two files with one id are a `duplicate-identity` refusal with both paths: on repair — when an arriving file carries the id of a block whose own tree file is whole and unchanged; on rebuild — a repeat in the scan. The refusal reaches the operator through mirror freshness, and the graph does not read until the copy is removed.

A trash successor loses the `supersedes` edge: a live successor from files would otherwise hit the single-successor uniqueness. A block whose file returned revives, and its still-trashed descendants get their batch. Rows deleted by graph steps with no journal event are wiped at indexing as before: trash does not restore them.

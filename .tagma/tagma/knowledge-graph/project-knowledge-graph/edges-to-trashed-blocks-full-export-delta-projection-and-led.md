---
id: 01a13691-8f1e-727d-b0b6-db274b21a394
title: "Edges to trashed blocks: full export, delta projection, and ledger render different block-file text"
ord: 42
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13675-2e34-7dd7-be20-c193361cae49",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1366a-82cb-7d9f-8a0f-dd23d11df7cd
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/export.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/ledger.ts
---
The block-file text is rendered in three places, and they diverge on edges to trashed blocks: full export (`graph/tree/export.ts` `exportGraphRows` — targets only live project blocks), delta projection and restore (`graph/tree/projection.ts` `encodedFiles` — any target with a uuid, trash included), and the ledger (`graph/tree/ledger.ts` `unreflected` — any target too). `Trash.delete` keeps edges, so an act on a block with an edge into trash writes a uuid into the file that is not in the tree, while `rewrite_graph_files` removes the same edge; the ledger compares against a third variant.

Decide: does the file carry the edge to a trashed block (by what tree reading into the mirror does with an edge to a missing uuid and what `restore_block` restores), and leave one owner of the mirror-row block-file text, read by export, delta, restore, and ledger (the one-fact-owner rule).

Done when: full and delta projection yield byte-identical files for a block with an edge to a deleted block, the ledger counts it as reflected; a test for it in `projectDeltaMatrix.itest.ts`.

Found by the [[d11df7cd]] review: moving `adoptIdentities` to `projectDelta` carried this divergence into the twin bring-up too.

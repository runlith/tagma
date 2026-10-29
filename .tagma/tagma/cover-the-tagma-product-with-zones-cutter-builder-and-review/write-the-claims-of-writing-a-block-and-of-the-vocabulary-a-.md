---
id: 01a0ca97-1376-7d41-975f-08718b6c8faa
title: Write the claims of writing a block, and of the vocabulary a project is declared in
ord: 198
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca9b-effb-7288-a42c-4212129b2d53",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca94-63c5-789a-9e91-c36105042d40
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/core/Act.ts
  - kind: file
    ref: apps/tagma/server/src/graph/core/Blocks.ts
  - kind: file
    ref: apps/tagma/server/src/graph/vocabulary/declarationRules.ts
---
Read `apps/tagma/server/src/graph/core/` — the act, blocks, edges, history, the trash, the transaction, the body diff and body file, the tag table, the catalogs and their installation — and `Graph.ts` for the composition all of it stands in.

Write the claims of [[867d7671]] and [[4792affd]], and the claims [[5940edc1]] states about the graph as a whole: what one act costs, what a write is total over, what a measured fact on a row means, what the trash keeps and for how long, and how a project's installed declarations become the gates every write is held to. Where the container above is broader than the code beneath it, qualify the container.

Done when every claim is written from the code and verified after a reading of all its sources, every symbol anchor resolves, `run_doctor` over these paths stands clean, and a review leaves no FALSE, OVERBROAD or UNSUPPORTED unresolved. Precision to match: [[d1caad35]] and [[249ce587]].
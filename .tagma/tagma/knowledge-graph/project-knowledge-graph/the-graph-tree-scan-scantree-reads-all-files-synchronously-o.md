---
id: 01a13691-8f1f-76da-94b0-4fa17b818582
title: The graph-tree scan (scanTree) reads all files synchronously on the server loop
ord: 43
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
    ref: apps/tagma/server/src/graph/tree/layout.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/scan.ts
---
`scanTree` → `readBlockTree` → `visitBlockTree` (`graph/tree/layout.ts`) reads the whole graph tree with synchronous `readdirSync`/`readFileSync` and parses every file on the server event loop; the cost grows with the block count. Callers on the loop: `adoptIdentities` (`graph/serving/identities.ts`, two full scans — twin tree and target tree — per adoption before a worktree merge), `level`/`fill` in `graph/serving/open.ts`, `rebuild` in `graph/serving/freshness.ts`, `advanceTree` with `fromTree: false`. For the runlith tree (~2900 blocks) this is the same stall class [[d11df7cd]] removed for `projectToTree` (there a synchronous walk reading every `.md` produced 0.8–1.5 s stalls).

Do: tree reading moves to the owner's worker (`graph/tree`), as already done for validation (`validation.worker.ts`) and titles (`serving/titles.ts`); callers receive `TreeScan` asynchronously. Where part of the tree suffices (twin adoption compares only new blocks against target places), read only that part.

Done when: scanning the runlith tree on its own `tagma:try` produces no loop stall, and the pass has a span in `read_performance`.

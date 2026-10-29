---
id: 01a0cad1-1179-7500-8c15-67f444d656c3
title: "Dead `ConflictedBlockError`: wire it into a write road or remove it"
ord: 153
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/conflicts.ts
---
`ConflictedBlockError` is exported from `Conflicts.ts` and imported nowhere in the checkout — neither raised nor caught. Enforcement is the tree-level `tree-mid-merge` refusal in `MirrorBuilder.writeThrough`, which answers before any block is touched.

Done when the error is wired into a write road that needs per-block refusal, or removed.
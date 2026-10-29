---
id: 01a12759-b2a5-76a9-87f4-27c88d80cd1c
title: A link-title resolution refusal stays a visible read state
ord: 9
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1276b-5dd4-7ace-ae65-41cbabecd417",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a12726-9e16-7f6a-a8a2-1530ab4f67c2
  - kind: implements
    to: 01a126b3-84d8-7b0e-a605-99311013e071
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/blockRefView.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlockTitles.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/Selection.svelte.ts
---
`BlockTitles.peer(name)` tells expected reads (`undefined`), a missing block (`null`), a found address, and `{ error: Refusal }` apart. `refresh(name)` performs a new read; the refusal keeps code, reason and unblock. `blockRefView` shows the refusal reason in the hint with no missing-block mark. Resync cancels past-generation reads; a late batch answer doesn't overwrite a refreshed address, and a live feed keeps the resolved link's project and branch.

The project list belongs to `Workspace`: the source snapshot loads when the app opens, so a new projectId from `read_titles` needs resolution through `projectsOf(ids)`. The owner refreshes the registry once for simultaneously awaiting reads; a missing-after-refresh project answers a typed refusal, and a cancelled first read doesn't wipe the fresh list.

Checked: 11 `BlockTitles.svelte.test.ts` unit tests, 2 `MarkdownBody.svelte.test.ts` tests, and a narrow svelte-check of sources and consumers — no errors. One independent review round; the branch and resync defects confirmed, fixed. The earlier self-closed tiptap-chip redraw defect [[ffabe318]] doesn't enter this work, by the operator's decision.

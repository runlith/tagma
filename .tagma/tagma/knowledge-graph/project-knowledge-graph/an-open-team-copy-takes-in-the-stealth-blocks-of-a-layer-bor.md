---
id: 01a194da-0b50-740d-b7a4-277b4513994a
title: An open team copy takes in the stealth blocks of a layer born after it opened
ord: 264
tags: ["task"]
fields:
  {
    "holder": "tagma:01a193ea-34cd-7827-8f66-267225b84179",
    "status": "in_work"
  }
edges:
  - kind: discovered-from
    to: 01a193d9-9a1f-79e8-9f71-7aa247a2ed10
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/serving/open.ts
---
A team project's copy opened before its stealth `layer.git` existed keeps a mirror without stealth rows. When the layer is born later — `set_graph_remote` births it from the remote through the exchange host's `open`, which attaches the copy's stealth hold — the blocks the remote holds stand in the layer's tree, but the mirror never scans them: `search_blocks` in that project finds none, while a project registered with the remote sees them. Reopening the copy over its standing mirror does not rescan either. Find where an attach of a stealth tree with content should project it into the mirror (the lazy attach in `graph/serving/open.ts` and the refresh's first read of a newly registered tree), and prove it with the `stealthBlocks.itest.ts` scenario where a clone without the remote is given one.
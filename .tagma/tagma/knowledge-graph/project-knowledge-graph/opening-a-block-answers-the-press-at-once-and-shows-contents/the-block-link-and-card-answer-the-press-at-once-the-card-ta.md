---
id: 01a14c0c-b751-7184-bed0-bdd0469f1f33
title: The block link and card answer the press at once, the card takes the address from the answer, the block page renders from read_block
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a14bf1-c8af-7caa-9840-1e1ee231c4b7",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/BlockPage.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/BlockCard.svelte
---
App: `BlockCard` takes the address from the write answer's `graphCopy` or the read row's `projectId`; links without an address (`BlockCard`, `BlockRefText`, `MarkdownBody`, body-editor link) get `aria-busy` at once on press until navigation; `BlockPage` renders the title and body from `read_block` without waiting for `ProjectTree`. Proof: measuring the click in a browser on a trial server (response ≤ 1 frame, contents < 100 ms for a warm project) and the card test through its public view.

**Result (commit dd566e0cc4).** Clicking an unresolved link to a global rule in a big-project block body (trial server, same fixture): before — no reaction for 12.0 s and 9.0 s, then URL and contents (operator's Chrome, n=2); after (headless Chrome, app warmed, n=5) — `aria-busy` in the same frame (0 ms), URL p50 100 ms (48–150), contents p50 121 ms (89–215); right after writing the same blocks — URL p50 172 ms, contents p50 261 ms. Navigating to a block in the same project — contents in 30–91 ms. Cold load of the whole app with a click as soon as a link appears — contents 0.5–1.0 s after the click. Early title and body edits of the page shown from `read_block` survive until the tree arrives (`TreeScreen.rename/setBody`). Card test: the address from `graphCopy` without a search.

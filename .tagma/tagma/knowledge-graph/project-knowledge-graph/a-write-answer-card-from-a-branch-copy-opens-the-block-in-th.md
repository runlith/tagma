---
id: 01a14c33-6619-7b95-a3d7-b3e38c99d630
title: "A write-answer card from a branch copy opens the block in the same copy: the write answer names its copy's branch"
ord: 70
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151a6-a002-78ee-a7a3-ea5b11d49251",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14c0c-6747-7325-a0f7-f79c508c4ca4
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/operations/answers.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/blockRefView.ts
    symbol: placedHref
---
A write answer carries `graphCopy` (project, checkout, tree) but no branch. The app builds the address only by branch, so a write card in a worktree copy (not the main checkout) takes the address from the name search, which prefers the page's current copy and the main address among a foreign project's copies: `update_block` in `beta/subject` over a block also present in `beta/main` opens in `beta/main` with the `subject` journal range. To do: the write answer names its copy's branch (the project's checkout list, `checkoutsOf`, knows it without a git process per answer), and `placedHref` opens the copy by it. Proof: a card test with a non-main-checkout `graphCopy` yields an address with `?branch=`. Verified red→green: the card keeps the branch and the diff on a conflicting search result; HTTP writes through cwd name the worktree branch and null for the main copy. Cards — 4/4; HTTP — 1/1, the rerun after typecheck fit in 5.78 s. App typecheck — 0 errors, 1 unrelated a11y warning; server typecheck ended with unrelated errors in ToolQuestion.ts and the rights, accountsDoor, recordingsDoor tests. Independent review — no findings. The running server was not restarted; no check in its interface was done.

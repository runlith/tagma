---
id: 01a146a2-0494-7e3f-8444-5329fc92f685
title: A window address aimed at a branch with no worktree returns to main instead of refusing no-checkout on every graph read
ord: 12
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1461f-0633-72db-bc1d-6aede5840007",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/FrameFollow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/worktrees/BoardState.svelte.ts
---
After merging and deleting the branch's worktree (`mcp-client` in another project), the window address kept `?branch=mcp-client`; every graph read got the server's `no-checkout` refusal, which the app showed as a toast. The server is right: a branch's graph is read in its checkout. Fix in the app: `Worktrees` (`features/worktrees/BoardState.svelte.ts`) knows that no row and no running creation stands on the address's branch, and `FrameFollow` returns the address to main.

Done when: the `Worktrees.svelte.test.ts` test holds the contract (a branch with no row is stray, a running creation is not), the app typecheck and tests are green, the commit is landed.

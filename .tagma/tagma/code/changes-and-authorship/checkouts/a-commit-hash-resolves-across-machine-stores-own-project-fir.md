---
id: 01a16f26-e4d3-7fac-937a-2916f60daffe
title: "A commit hash resolves across machine stores: own project first, each store once, an ambiguous id is not guessed"
ord: 24
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a16f26-e431-7c77-b884-76d2a1457df1
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/commitCode.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/CommitLinks.svelte.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/repositories/listing.ts
    symbol: makeCoveredRepositoryReader
---
Inline code of hex characters only is a commit candidate, not a path: otherwise every hash would go into a file-existence check. The price is a file with a hex name and no directory, written as inline code, which does not become a file link.

Stores come from project coverage and group by `repositoryId`: worktrees of one repository share objects, and a second question to the same store would give the same answer for the price of another git process. The search runs on two levels — the calling project, then all the rest together; the second level asks only for what the first did not find, so a hash from its own project costs one or two git processes, while a hash found nowhere walks every machine store. The app remembers the answer for the place's lifetime, so a rerender does not ask the server again.

A short id that git calls `ambiguous` in one store, or that different stores of one level resolve to different commits, is not answered: a link to a guessed commit is worse than no link. A project whose coverage or git failed to read goes to `unread` and does not cancel the answer.

---
id: 01a12752-2521-73c6-83d7-b3a75d61cfcf
title: A checkout read by named paths is limited to one command line; beyond it the whole tree is read
ord: 6
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
    symbol: sharedTree
  - kind: symbol
    ref: packages/git/src/status.ts
    symbol: pathspecFits
---
Tree marks between two reads accumulate named paths, and the read passes them to `git status` and `git diff --numstat` as arguments: these commands have no pathspec over stdin. Under a dozen agents in one checkout the path set outgrew the command-line limit, `spawn` failed with `E2BIG`, the read loop broke, and the checkout line stayed stale.

So named paths weighing more than 16 KiB (with the `:(literal)` prefix) read as a full tree read. The limit lives in git-kit (`pathspecFits` in `@runlith/git/status`); the live graph-tree refresh and the Holdings probe decide by it too: a small number of long paths can also overflow the command line. The limit stays below the narrowest command line through which Tagma launches git (32,767 characters on Windows), and reading by that many paths is already no cheaper than a full `git status`.

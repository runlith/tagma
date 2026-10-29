---
id: 01a15039-8cdd-7819-8aef-197717688b76
title: An operator move of a directory with a single-letter case change writes files under the directory's new spelling
ord: 12
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a1502a-fc79-7600-8da6-a04f5c0b49e2
sources:
  - kind: file
    ref: apps/tagma/server/src/checkout-files/entries/tree.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
    symbol: spelled
---
`move_entries src → Src` is supported on a case-insensitive FS (`checkout-files/entries/tree.ts`: `taken` checks `sameEntry`), but the facts land wrong: `CheckoutPaths.spelled` canonicalizes the `Src/a.ts` parent via realpath, while before the move `Src` is still `src`. Both sides of the pair get the `src/a.ts` place, the journal holds no `Src/a.ts`, and landing will not carry the move. It was so before [[5c0b49e2]] too; there the file leaf got its spelling, directories did not. Found by review (turn-review-sol).

Decide which spelling the place calls a directory that on disk is an alias of another spelling: realpath is needed for symlinks and matching against checkout roots (a root may be named in another case), while a delete through a directory alias (`SRC/a.ts` with `src` standing) must land on `src/a.ts`. A move's destination cannot be told from an existing directory's alias by one path alone — the destination likely must pass its place explicitly.

Proof: an itest of an operator directory move `src → Src` with a file inside — the journal holds the `src/a.ts` delete and the `Src/a.ts` write with `movedFrom`, `submit_work` lands the move.

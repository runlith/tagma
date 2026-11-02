---
id: 01a19910-1fa7-7b67-b163-895eb7907dd1
title: Checkout entry marks follow input revisions, not diff line counts
ord: 31
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/GitDiff.svelte
  - kind: file
    ref: apps/tagma/server/src/workspace/checkouts/comparison.ts
  - kind: symbol
    ref: apps/tagma/server/src/workspace/contract/wire/checkout.ts
    symbol: CheckoutEntry
---
Different contents and submodule references can produce the same status and line counts. Entries therefore carry the checkout input epoch read with them; consumers use this mark to refresh open comparisons. A named reread preserves marks outside its paths, while an unnamed tree or index invalidation marks the whole reading. Metadata-only rereads retain the marks.
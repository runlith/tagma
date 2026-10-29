---
id: 01a16bde-f264-7b7c-8e0f-1a3591d38b38
title: Checkout membership check of a path compares physical addresses
ord: 22
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/paths.ts
    symbol: makeCheckoutPathService
---
An absolute path can name a checkout through a link to the root itself or its parent: for example, `/tmp` and `/private/tmp` on macOS. `CheckoutPaths.pathWithin` resolves that spelling before the membership check, otherwise an existing file of its own checkout gets refused. A link target outside the checkout still refuses, and a missing path tail is checked against the nearest existing parent.

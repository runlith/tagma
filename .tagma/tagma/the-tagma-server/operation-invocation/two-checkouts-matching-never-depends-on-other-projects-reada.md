---
id: 01a16d09-cf4f-7a52-aac3-536ed0c73f7c
title: Two checkouts matching never depends on other projects' readability
ord: 13
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a16cc7-ef9b-7903-a857-9e08d62e336e
sources:
  - kind: symbol
    ref: apps/tagma/server/src/invocation/admission/place.ts
    symbol: sameCheckout
---
Admission already knows both catalogs and compares their witnesses instead of re-resolving their membership through the machine-wide shared index. Otherwise a moved repository with an unreadable linked worktree of another project would break someone else's act when checking whether its place needs changing.

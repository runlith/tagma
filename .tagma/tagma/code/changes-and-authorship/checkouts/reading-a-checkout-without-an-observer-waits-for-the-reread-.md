---
id: 01a12754-854a-7100-b0d4-a01f424310a3
title: Reading a checkout without an observer waits for the reread that started after the request, not for a new revision
ord: 28
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/workspace/checkouts/rows.ts
    symbol: GitCheckoutRows
---
`settle` does not raise `revision` when the row is unchanged and the checkout has an observer. The "to poll or not" decision is made earlier by `read`, by the observer at call time. When an observer opened in between and the tree stands, the revision growth never arrives. So `read` waits for the `finished` counter at the reread count following `started` at request time: this reread started after the request, and whether it changed the row does not matter. `finished` also grows on failure or interrupt, so a waiter never leaves without an answer.

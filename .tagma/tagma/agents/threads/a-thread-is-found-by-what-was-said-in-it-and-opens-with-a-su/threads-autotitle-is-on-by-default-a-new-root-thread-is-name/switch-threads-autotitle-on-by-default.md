---
id: 01a1031e-d5ce-7656-be01-1b1f6494cb00
title: Switch `threads.autoTitle` on by default
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1031f-50dc-7ab4-83d5-63966909d3e6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff2b-54ff-7f7f-91d2-8f552a2eb46e
sources:
  - kind: symbol
    ref: apps/tagma/server/src/threads/contract/wire/settings.ts
    symbol: autoTitle
---
Builds [[2a2eb46e]]: the `autoTitle` key fallback in `apps/tagma/server/src/threads/contract/wire/settings.ts` becomes `true`.

Done when the spec's acceptance is met.

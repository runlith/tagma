---
id: 01a14b1b-14eb-75f6-a49c-490d16e172ad
title: "Tooltip: one host and `Tooltip` on the kit stack"
ord: 18
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-68fe8e55c839
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490bb2ab8869
sources:
  - kind: dir
    ref: apps/tagma/app/src/lib/shared/ui/tooltip
  - kind: file
    ref: packages/primitives/src/tooltip.svelte.ts
---
Build the [[8e55c839|tooltip]]: kit state, app host, `Tooltip` without bits instead of `Hint`.

Done when: the spec's unit tests pass, `shared/ui/tooltip` has no bits, commit.

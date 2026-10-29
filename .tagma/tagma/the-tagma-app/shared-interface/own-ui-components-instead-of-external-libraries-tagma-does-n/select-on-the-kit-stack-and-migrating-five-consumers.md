---
id: 01a14b1b-14eb-75f6-a49c-490f5029c4ff
title: Select on the kit stack and migrating five consumers
ord: 20
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a13d48-9aa9-71d0-a2d8-69007e9ccf82
  - kind: waits-on
    to: 01a14b1b-14eb-75f6-a49c-490cfb3764ac
sources:
  - kind: file
    ref: packages/primitives/src/select.svelte.ts
---
Build the [[7e9ccf82|select]].

Done when: the spec's unit tests pass, `shared/ui/select` has no bits, commit.

---
id: 01a145a1-fd09-73ce-9f77-af593cb02c1e
title: Commit gate install recognizes a hook a manager rewrote over the gate, and restores the gate instead of refusing
ord: 47
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1457e-b3df-721a-b633-e86cc903d6a8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a1458b-fed6-736e-84e1-c73154c13672
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/hooks.ts
---
`npm install` runs `husky`, which rewrites `.husky/_/<hook>`, wiping the gate. `placing` saw someone else's hook with `<hook>.tagma-chained` already standing and answered `held`: the gate was never installed again, and Tagma checks for `git commit` silently switched off.

To do: someone else's hook with a standing chain is a manager hook rewritten over the gate. It becomes the new chain, and the gate takes its place. Proof: install itest — after a hook rewrite, a repeated install answers `chained`, the gate stands, the chain carries the new text.

---
id: 01a145a8-83f1-7cf7-a01b-8f6bb07cc691
title: The commit gate restores itself right after hooks are rewritten mid-session, not only at server start
ord: 5
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a145a1-fd09-73ce-9f77-af593cb02c1e
sources:
  - kind: file
    ref: apps/tagma/server/src/enforcement/commits/hooks.ts
  - kind: file
    ref: apps/tagma/server/src/enforcement/serving.ts
---
Gate install recognizes a hook a manager rewrote over it and puts the gate back. But it only runs at server start (sweep), root publication and project registration. If `npm install` rewrote `.husky/_` mid-session, `git commit` in that checkout runs without Tagma judgment until the next start.

A cheap trigger at the owner — a non-recursive watch of the allowed hooks directory through `platform/watch/tree.ts` (`watchAll`). Filter by managed hook names, one watch per directory shared across checkouts. On event the owner re-installs the touched hook, itself frees and reopens the watch and follows `core.hooksPath` changes. The watch fixes with a delay: a commit right after the rewrite may beat it.

Proof: itest — after a hook rewrite with no repeated install call, the gate stands again.

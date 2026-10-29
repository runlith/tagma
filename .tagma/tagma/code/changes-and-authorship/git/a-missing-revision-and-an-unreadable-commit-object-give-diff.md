---
id: 01a1352f-20e5-78df-9c53-7aae8edb74d3
title: A missing revision and an unreadable commit object give different commitOf outcomes
ord: 109
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a1323b-8054-75f6-9a4e-19bd27a3d0b1
sources:
  - kind: symbol
    ref: packages/git/src/repository.ts
    symbol: commitOf
---
Git's quiet verification answers one code both when a revision is missing and when its commit object cannot be read. So a failed conversion into a commit does not prove the revision is missing: when the ref itself resolves, `commitOf` keeps the typed refusal and returns `null` only for quiet absence. Git diagnostics and a truncated answer stay a refusal; extra resolution is needed only on an ambiguous outcome, plain commit reading costs no more.

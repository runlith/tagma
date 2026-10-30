---
id: 01a0c702-be20-70fe-a959-587c7c80eb1e
title: Treat a change to canonicalJson's byte form as a digest format change for every owner that stores a digest of it
ord: 15
tags: ["rule"]
sources:
  - kind: file
    ref: packages/utils/src/number.ts
  - kind: file
    ref: packages/utils/src/object.ts
  - kind: symbol
    ref: apps/tagma/server/src/change-record/threadFiles/patch.ts
    symbol: digestOf
  - kind: symbol
    ref: packages/utils/src/object.ts
    symbol: canonicalJson
---
Before changing the bytes, find every consumer that stores a digest of that string, including the sha256 worktree intent.
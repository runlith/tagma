---
id: 01a0c839-1839-7a0a-84c0-ef5502f61498
title: List the repo returned by `Repo.tune(key, tuning)` in the manifest in place of the bare repo key
ord: 10
tags: ["rule"]
sources:
  - kind: symbol
    ref: packages/query/src/repo.ts
    symbol: tune
---
The tuned layer provides the same key, so the bare key would stand beside it untuned.
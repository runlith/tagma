---
id: 01a0caa9-db0a-760e-9b56-840b27f8e72c
title: A diff mark can land inside a live `[[hex]]` reference, which `tokenize` does not keep atomic
ord: 131
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/bodyDiff.ts
    symbol: tokenize
---
`tokenize` keeps `` `code` `` and `[[L-123]]` atomic so no diff mark lands inside them, but its reference pattern matches only the `L-digits` spelling while the references bodies actually carry are `[[hex]]`. A live `[[5940edc1]]` is tokenized as brackets and a word, so a mark can land inside it and split the reference in the rendered range. The comment above `tokenize` promises `[[name]]` generally. There is no `bodyDiff` test file.

Done when the tokenizer keeps the reference spellings bodies carry atomic — proved by a test that diffs a line containing a `[[hex]]` reference and shows the mark landing outside it — or the promise is narrowed to what the pattern keeps.
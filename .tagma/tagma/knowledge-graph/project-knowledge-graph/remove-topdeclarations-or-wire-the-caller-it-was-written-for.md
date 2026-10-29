---
id: 01a0caa8-af00-7b82-9390-49411b865c6c
title: Remove `topDeclarations` or wire the caller it was written for
ord: 134
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/sources/readers/regions.ts
    symbol: topDeclarations
---
`topDeclarations` is exported from the region reader and called nowhere outside its own file — the only matches in the checkout are its definition and the same-file `REGION_READER` identity entry (regions.ts:290). It cuts top-level declarations by the same reader a symbol source is measured with, so it may be a road meant for a caller that never landed.

Either wire the caller it was written for or remove the export. Done when no dead export stands beside the live reader, or a caller outside this file reads it.
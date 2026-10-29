---
id: 01a0c8cb-0484-7927-9cf6-fdf5432e393f
title: The Cursor deployment table cannot be composed by this package's own composer
ord: 48
tags: ["task"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: packages/llm/src/models/cursor.ts
  - kind: symbol
    ref: packages/llm/src/models/catalog.ts
    symbol: modelCatalog
---
22 of its 39 rows carry no window, and a text row with no measured window fails the WHOLE catalog at composition ([[20a38f55]]) — proven by execution: `modelCatalog([cursorDescription])` throws on the first row. The table is also named by no exports entry and stands outside the default set, and `servedAs` on its rows is read by nothing.

Either it is mid-construction, in which case say so, or its admission needs a decision. Claimed as [[d0d99633]].
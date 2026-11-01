---
id: 01a13c1b-244f-7763-a9fc-9624bc178383
title: "A statement page is bounded by bound-value count and text: the synchronous write cost on the loop grows mainly with values"
ord: 7
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/binds.ts
---
`rowsPerStatement` is a SQLite limit (32,766 values), not a page. A multi-row write is cut into pages by `pagesOf` over `PAGE_VALUES` and `PAGE_TEXT`: building the SQL, two regex passes over its text (the write check and the span fingerprint) and serializing parameters into IPC run synchronously on the loop, and their cost grows with values more than with text. A statement with 32,766 values and no text cost 29 ms on an M2 Max — past the loop budget on a weak machine; the constants carry margin for a machine 4 times slower (measurement and derivation — in the [[469a49ea|mirror rebuild]] task).

A row heavier than a page goes alone: its size is the size of its data, there is nothing to split it by. Row weight is its whole text, including JSON of fields: fields of a single runlith block can exceed 1.8M characters.

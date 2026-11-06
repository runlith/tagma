---
id: 01a1aec4-32c2-7460-852d-2962655c2bf8
title: The mirror keeps a block's sources in its file's order, on rebuild as on repair
ord: 24
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/mirror.ts
    symbol: rebuildMirror
---
The projection writes a block's sources in mirror row order, so the rows must follow the file. A rebuild that sorted them made the next projection of every block with unsorted sources rewrite its file in that checkout alone: a commit of nothing but reordered lines, which later turned another branch's move or deletion of that block into a modify/delete conflict of the graph twins.
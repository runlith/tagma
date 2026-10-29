---
id: 01a173e9-986d-7f3b-ade4-c9f3fbf522ca
title: A line the shortest diff paired with another equal line belongs to the edit that caused the move, not to nobody
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a173ce-e2ca-76bd-9d68-569034fc8341
sources:
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: displacedTo
  - kind: symbol
    ref: apps/tagma/server/src/change-record/lines/projection.ts
    symbol: transferredBy
---
The folding remembers which HEAD line each working-file line continues, while the patch against HEAD is the shortest diff of the whole file. One record's alignment starts from unique anchors and need not be shortest, so the patch can pair equal lines differently than the folding: a line the folding counts as a HEAD line is added in the patch, and its HEAD line is paired with another equal line or deleted; mirrored for a deleted line.

A move chain finds the author of such a line: from the HEAD line to its pair in the patch, from the pair to the HEAD line it continues, and so on to the end. The end decides:
- a working line missing from HEAD — a recorded insertion the patch paired with a HEAD line: the line belongs to the insertion's author;
- a HEAD line missing from the working file — a recorded deletion the patch paired with a working line: belongs to the deleter;
- a moved line on the other side — the patch shows a move, and it belongs to the last writer among the patch pairs the move crosses: the insertion's author, the HEAD-line mark, or the HEAD-line deleter.

A line stays nobody's only when no recorded edit explains the chain. Without the chain, a record that moved repeated lines — function parameters in a function move — gave one of its lines to nobody: the landing left it on disk, and the commit carried calls without the parameter declaration.

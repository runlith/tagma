---
id: 01a15147-72f8-7678-a2cb-7d94c189a51b
title: Mirror repair parses a small set of changed block files on the loop and a larger one in a one-shot worker
ord: 9
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a15134-0b9f-7e2c-809e-ec1dfe91cabe
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/blockReads.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/mirror.ts
    symbol: repairMirror
---
The arrivals set of incremental repair is unbounded: an external bulk edit, checkout, or merge brings hundreds of files, and parsing each (YAML and frontmatter schema) is visible synchronous work. Such a set is read and parsed in a worker. Starting a worker costs more than parsing a few files, while the ordinary repair is one or two external edits awaited by the next act. So a set no larger than `ON_LOOP` is parsed on the loop. The limit must keep such a pass below the noticeable-delay threshold on the weakest machine and stay where starting a worker is still more expensive than the parse itself.

The same reader runs duplicate-identity checking — reading the files on which the mirror holds the arriving blocks' ids. It stands inside the repair transaction, so a large set holds the mirror writer for the worker's startup.

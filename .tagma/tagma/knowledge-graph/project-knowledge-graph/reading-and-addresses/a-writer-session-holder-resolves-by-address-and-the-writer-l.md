---
id: 01a1654c-576c-7fe0-8e1d-8596c5901dee
title: A writer-session holder resolves by address, and the writer list preserves the question in a cursor
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/operations/history.ts
  - kind: file
    ref: apps/tagma/server/src/graph/journal/writers.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/journal/eventLog.ts
    symbol: journalLayer
---
A block's holder keeps the writer's identity in the graph copy: address reading preserves the block's original-read project and checkout and does not require listing the project's history or changing the stored holder fields. The shared writer-session projection returns an address only for a Tagma thread; an external CLI key is never passed off as such an address. The list is bound to project and checkout through a cursor, walks an immutable id, and returns a page with a total in one SQL read: new writers do not shift an already-read edge. The default covers the working agent's recent neighbourhood, and a known holder reads directly; the ceiling counts the heavier JSON row so text and machine answers fit the tool envelope.

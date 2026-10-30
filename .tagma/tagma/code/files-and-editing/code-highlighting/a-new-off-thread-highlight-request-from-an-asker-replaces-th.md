---
id: 01a0c6fb-b480-71be-b94f-0b736eafebea
title: A new off-thread highlight request from an asker replaces that asker's pending one, which resolves to undefined
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/chat-ui/src/entries/ToolDiff.svelte
  - kind: symbol
    ref: packages/chat-ui/src/entries/diffPieces.ts
    symbol: DiffHighlight
  - kind: symbol
    ref: packages/highlight/src/offThread.ts
    symbol: highlightLinesOffThread
  - kind: symbol
    ref: packages/highlight/src/offThread.ts
    symbol: supersede
---
`highlightLinesOffThread` takes an `asker` id (the diff instance's `$props.id()`); only requests sharing that id supersede each other. Two readers sharing an id would cancel each other's highlighting, so every reader passes its own.
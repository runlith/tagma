---
id: 01a0c6fb-b480-71be-b94f-0b736eafebea
title: A new off-thread highlight request from an asker cancels that asker's pending request only while no other asker waits on it
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
`highlightLinesOffThread` takes an `asker` id (the diff instance's `$props.id()`). Equal requests share one pending entry; a new request from an asker resolves to `undefined` and drops each pending entry whose every waiter is that asker, while an entry another asker also waits on keeps running. Two readers sharing an id would cancel each other's highlighting, so every reader passes its own.
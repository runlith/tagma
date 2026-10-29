---
id: 01a17ab6-79f8-7a22-a439-1a3169a45344
title: Document search across the app is one FindBar card, floating above content everywhere except the browser
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/shared/ui/find/FindBar.svelte
---
Editor, compare and diff, terminal and embedded browser all search with one `FindBar` card; a place has no search panel of its own. What the card shows is decided by the place's engine: toggles and replace appear only when the engine supports them (the browser has no toggles, a read-only file and diff have no replace).

The card floats in the top-right corner above the content instead of docking as a strip above it. A strip would shift code on every ⌘F and Esc, steal lines in the terminal, and hand the program a resize. The exception is the browser: the page there is a native Electron view the app DOM cannot overlap, so the card docks as a strip above the page (`docked`).

The card catches keys at its own root, not on its fields: Esc, ⌘G and F3 work even when focus moved to a toggle or button, and Enter walks matches only from fields, so a focused button presses as a button.

Count words: "2 of 5" — the current one among all, "5 results" — when the selection is off-match, dimmed "No results": an empty answer is not a failure. Red is only for an engine refusal: a bad regular expression, an overlong terminal query.

---
id: 01a17ab6-79c7-77cb-9a64-c79a85954eeb
title: "The CodeMirror search panel in the kit is empty: the caller draws the card through the find snippet"
ord: 6
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/code-editor/src/extensions/find.ts
  - kind: file
    ref: packages/code-editor/src/FindLayer.svelte
---
CodeMirror search stays the engine: its query, commands and "panel open" state drive match highlighting, the `matches` field for the overview ruler, and the count. But the CodeMirror panel DOM lives outside the Svelte tree, while the search card needs app components — hints, keys, the shared `FindBar` — which the kit neither knows nor should know. So the panel the kit hands CodeMirror is empty: it only reports opening, change and closing to `FindBridge`, and the caller draws the card with its own `find` snippet in a layer above the view. A view without the snippet installs no search at all: otherwise ⌘F would open a search that cannot be seen or closed with the mouse.

Two of the kit's own mechanisms follow:
- ⌘F and ⌥⌘F are its own commands, not `openSearchPanel`: that one looks for the input inside the panel DOM, which belongs to the caller, so a repeated ⌘F with search open would not move focus into the field. Its own commands take the query from the selection or the word under the caret and request focus through the `asked` hook.
- The card floats above the start of the text, so the kit reports its height as a scroll offset: the current match never scrolls under the card.

The "2 of 5" count comes from the same `matches` field as the ruler and hits the same ceiling. The field holds each match up to its `end` boundary: at the ceiling the boundary stands past the last match found, edits rescan only lines before it, and the count answers `more` plus the current number — only inside the boundary. Without the boundary, an edit outside the scanned part would silently shrink the "exact" number.

Changing the replacement text (`replace`) does not rescan the document: the field compares queries without it.

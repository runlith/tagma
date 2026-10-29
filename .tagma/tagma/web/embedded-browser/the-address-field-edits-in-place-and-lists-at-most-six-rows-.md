---
id: 01a182f9-ab22-7cab-86dc-f6a08eece873
title: The address field edits in place and lists at most six rows under itself only for typed text, and Enter follows the keyboard-chosen row, never the hovered one
ord: 3
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14c08-1c3f-7bde-a2e3-0462886d0b63
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/AddressBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/browser/Omnibox.svelte.ts
---
A click or ⌘L edits the field in place, at the same size: nothing around it moves and nothing is listed until a letter is typed. An earlier version spread a card over the whole toolbar row and listed every served address and open page on focus; with a few dozen open pages that filled the pane to the window's bottom. The list now hangs under the field at its width and holds at most six rows, row zero being what Enter does.

The page is a native Electron view the app DOM cannot overlap, so the list registers its rect with the overlay stack (`overlayLayers.notice`) and `NativeView` swaps the page for a snapshot while it stands. It is not a `Popover`: a popover counts a press in the field as outside and would close under a click that only moves the caret; the field's own focus and blur open and close the list instead.

The keyboard-chosen row is the field's own state, separate from the pointer: ↑↓ write the row's address into the field and Enter acts on that row, or on row zero. The choice is held as the row itself, not its index: the list is rebuilt from live sources (a page becoming active reorders open pages, a terminal starts serving), and an index would let Enter open a row the field never showed. Hover only tints a row and a click picks it. The shared `Collection` was not taken: in a text field it consumes Home and End for its own highlight, and it has no step that writes the chosen row into the field or returns to the typed text above the first row. Esc steps back one level at a time: the preview or completion, then the page's address, then out of the field.

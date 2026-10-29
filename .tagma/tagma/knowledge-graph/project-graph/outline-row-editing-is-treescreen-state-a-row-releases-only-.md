---
id: 01a175bc-4e44-72c1-8b46-eaa8bad47cdb
title: "Outline row editing is TreeScreen state: a row releases only the edit it took, and leaving the window does not release the edit"
ord: 2
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/Row.svelte
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/TreeScreen.svelte.ts
    symbol: TreeScreen
---
`TreeScreen.editing` names the row in edit and the edge where the caret lands. Rename, F2, new block, edge arrows and structural acts over the row in edit set it as a new object. The row that focuses the title remembers that object and on blur releases only it (`leave`). Nesting, unnesting and moving recreate or carry the row, and the old instance's blur can arrive after the act re-set the edit. Comparing by value would release that new edit, and the row would leave writing mode mid-Tab.

The tree row's title text is written to the DOM only while the title is unfocused, not while the row is unedited. A new instance after nesting is born in edit but still unfocused, and receives the text before the caret lands. Otherwise it would stay empty, and the next blur would save an empty title. The row the arrow took the edit away from keeps the typed text until its own blur, which saves it. Otherwise the rollback to the old title would beat the save.

A blur while the document is unfocused (`document.hasFocus()` false) saves the title but does not release the edit. Switching to another window is not leaving the row, and on return the browser brings focus back to the same title. Structural acts continue the edit only when the row was in edit before the act: deleting from the menu, unlike Backspace in an empty row, does not move the edit to a neighbour.

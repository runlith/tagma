---
id: 01a0cb5b-b2f1-7d60-9022-386a02352b2d
title: The drawer's placeholder promises Enter opens the output face; Enter unfolds instead
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d56b-7069-7539-9fda-fe48df0376fb",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/CommandActivity.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/terminals/ProcessesPage.svelte
---
`ProcessesDrawer.svelte:199`'s empty-state placeholder reads "Select a line and press ↵ for its output." Enter on a line unfolds it in place (`CommandActivity.svelte.ts:767-769` toggles the line) and never opens the Output face, whose only writers are `openOutput` (`ProcessesDrawer.svelte.ts:127-132`) reached from the row's output button (`ProcessLine.svelte:232`) and the badge (`ActivityBadge.svelte:85`). The copy teaches a key that does not do what it says.

Fix the sentence to the keymap's truth (or make Enter open the face — the copy's promise is the better affordance if the keymap can carry it). Done when the placeholder and the key agree.
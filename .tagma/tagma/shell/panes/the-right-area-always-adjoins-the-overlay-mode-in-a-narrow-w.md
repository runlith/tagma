---
id: 01a15ae1-9814-735f-96cb-923ad487ae94
title: "The right area always adjoins: the overlay mode in a narrow window is removed"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15ac1-2b9a-7fc6-b993-3b1f606e8186",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15acf-0a1e-7276-a2da-129ec6c1eb6e
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/AreaFrame.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/RightArea.svelte
---
Operator: the layout must not change with the window width. Now, when less than `MAIN_MIN` remains for the main column, the right area lays over as an overlay with a backdrop and its own tab line under the header (`AreaFrame.overlaid`). Remove that mode: the area always adjoins, tabs are always in the header, in a narrow window the area shrinks to its minimum, and only then the main column narrows. Correct the explanation [[f4f557ea]].

Proof: typecheck, the `SidePanes` test, a trial-instance snapshot in a narrow window — tabs in the header, no overlay.

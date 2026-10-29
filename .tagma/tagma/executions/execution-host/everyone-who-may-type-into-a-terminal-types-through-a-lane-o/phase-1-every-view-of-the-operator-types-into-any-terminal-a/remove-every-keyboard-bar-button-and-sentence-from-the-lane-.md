---
id: 01a0cf4b-e148-79f3-b486-07e43320f75c
title: Remove every keyboard bar, button and sentence from the lane road's terminal surfaces, and add Take over to the pane menu
ord: 10
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d01f-4af3-7ca0-93e1-695681797232",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0cf56-281d-7ffa-a766-934722097468
  - kind: waits-on
    to: 01a0cf4b-e143-70f4-9a38-34e752c27ff4
  - kind: waits-on
    to: 01a0cf4b-e145-75fe-9035-2347893509b3
---
Build the surface part of [[22097468]] (section 5, Surface), `ProcessLine.svelte`'s line included, once the pane and the grid parts stand: the bars, the button and the sentences go from the lane road, and Take over stands in the pane menu. The `controlled` and `watching` states stay, because today's road still draws its surface from them; they go with that road in [[afbf1202]]. Done when the surface cases of section 7 hold live, the claims its section 8 names as dying are replaced by claims written from the code, and doctor over `apps/tagma/app/src/lib/features/terminals` and `features/harness` is clean.
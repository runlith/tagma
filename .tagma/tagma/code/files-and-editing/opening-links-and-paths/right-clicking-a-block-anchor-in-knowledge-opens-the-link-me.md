---
id: 01a175bd-7fd5-7c46-b9f5-140b5a24b427
title: Right-clicking a block anchor in Knowledge opens the link menu, whose steps state that a click there is a page navigation
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a175ae-80f0-7cbf-b382-3f7fb4948f1c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
  - kind: relates
    to: 01a1741f-a3b7-7fc0-bf9a-6e37d7bc5513
  - kind: relates
    to: 01a1744e-1362-7314-8205-5ff9ce1ef098
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/opening/Opening.svelte.ts
---
Criterion 6 of spec [[d7bc5513]] requires a view menu on right-click on any link. In Knowledge block anchors have none: breadcrumbs, Links, outline rows and view results show the system menu. `Opening.listen` gives a menu only to an anchor the view claims as its own (`LinkKind.anchor`), and the `block` view does not claim its own routes: clicking them stays a page navigation ([[ce1ef098]]). Found when an outline row became a link to the whole block ([[519b9f89]]).

An owner-held menu is needed (`features/opening`), one mechanism for all block anchors in Knowledge. Menu steps name what gestures do at that place: clicking a block anchor in Knowledge is the full place, not "nearby". Whether Knowledge has a "nearby" gesture or item is decided at the 10/10 gate and named. The test targets the contract through the public entry. Start after `dir-paths` lands its edits in `features/opening` and `BlockPage.svelte`.

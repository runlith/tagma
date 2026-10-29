---
id: 01a0ca5e-42d2-7cfd-ba57-565edc588bbd
title: Write the claims of what a product fills in
ord: 165
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca5c-5906-74eb-a8b8-6650cb732496
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Read `packages/chat-ui/src/renderers.ts`, `strings.ts`, `surface.ts`, `theme.css`, with `theme.test.ts` beside them. Write the claims under [[99576957]]; the module is [[cb732496]].

This is the package's product-free boundary stated as contracts, and several of its rules are load-bearing: strings are functions rather than values so a locale switch repaints rows already on screen; a renderer registry is partial by contract; an asynchronously parsed body must report that it landed or the row stands at a remembered height; the stored disclosure record is parsed rather than trusted. Check each against the code — the module's own boundary claims already cover the palette and the storage schema, so do not restate [[52014f36]], [[88c9de7d]], [[a639b79c]] or [[04bd84aa]].

Reference zones: [[d1caad35]] and [[de36c9fd]] — match their precision, never their size. Proof: claims written from the code and not from the comment beside it, each bound to the narrowest sources that can contradict it and verified after reading them; the area's body corrected where the code contradicts it; the doctor over these paths clean; a review passed.
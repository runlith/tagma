---
id: 01a15630-dd60-7471-a0f8-d9c9bfca0320
title: "Build the window per spec: one three-zone bar, TabLayouts, and a right area of tabs"
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15631-0832-7cc5-a462-4d49c954c2cd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15622-e2ef-7840-b59b-5e32e200e09f
---
Build the [[e200e09f|spec]] in full: it is approved by the operator and reviewed against the code (thread `01a15624-91c4-7afa-9459-56d1bddba817`).

Start with `TabLayouts` and the right-area container (`app/panes/SidePanes.svelte.ts`), then one view at a time: thread, browser, call, plugin, changes, file, terminal. After that the window bar (`TopBar`, `Header`, `ChatShell`), search, sections, narrow window, page snapshot under the menu. Independent large parts as child tasks.

Proof is the spec's acceptance: `TabLayouts` and container tests, app typecheck, demo build. Blocks named in the spec fixed by the same change.

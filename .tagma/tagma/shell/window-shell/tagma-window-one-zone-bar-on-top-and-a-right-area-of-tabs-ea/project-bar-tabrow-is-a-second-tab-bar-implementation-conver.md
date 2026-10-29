---
id: 01a156c4-ba1d-7a6b-9746-7631c2c0cbe2
title: "Project bar (TabRow) is a second tab-bar implementation: converge on TabRail"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a156b9-b502-7afb-9810-3aa33a869692
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/TabRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/shared/TabRail.svelte
---
`features/projects/TabRow.svelte` repeats the tab-bar mechanism on its own:
- `Reorder`;
- tab squeezing (`w-48 min-w-28 shrink`);
- bar-less horizontal scroll;
- pulling the active tab into view;
- a cross visible on the active tab and on hover.

This breaks rule dd380bf6. Differences from `TabRail`:
- "pill" tabs in the window title's sunken strip (drag region);
- its own `StripMenu` context menu;
- a chorded hint;
- hover prefetch;
- `PulseMarks`.

Needed: `TabRail` gains a look variant and context-menu replacement, and `TabRow` draws through it.

Proof:
- one tab bar in code;
- project-bar behavior unchanged: reorder, close, chords, prefetch;
- typecheck and `features/projects` tests.

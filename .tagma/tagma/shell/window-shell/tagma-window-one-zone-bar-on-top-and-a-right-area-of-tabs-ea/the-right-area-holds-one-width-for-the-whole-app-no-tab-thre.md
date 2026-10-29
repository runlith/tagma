---
id: 01a156ce-c710-7790-a798-6304161ee1e3
title: "The right area holds one width for the whole app: no tab, thread, or view changes it"
ord: 4
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
---
The area width now jumps for two reasons:
- it lives in each holder's layout: the thread, draft, and section each have their own;
- each tab view has its own geometry: base, min, and max differ for changes, terminal, file, browser, thread, call, and plugin.

So switching tabs or threads changes the width.

Needed: width is a window-area property. One owner (`SidePanes`) holds one width for the whole app, in all projects. The area geometry is one and view-independent. `PaneKind.size` and `TabLayout.width` leave. A narrow window only limits the shown width, never touches the stored one.

Proof: an owner unit test — a width set on one holder and view stands on another holder and view and after reload. Plus typecheck and panel tests.

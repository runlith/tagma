---
id: 01a14c05-9e8f-7c75-a633-b2a70614903d
title: The right area opens everything beside the work as tabs, and each thread remembers its tab set
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-76f5-7c7d-bd06-8e7f03fd84a3
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a3d7370c0e
  - kind: relates
    to: 01a14c05-9e8f-7c75-a633-b2a640beeb16
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/AreaFrame.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/panes/SidePanes.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/app/shell/DesktopShell.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/seats/ThreadSeats.svelte.ts
---
**Value.** The operator keeps another thread, file, graph block, commit with its files and diff, diff, Changes, the thread's work in the graph (Work), its own terminal, a browser page, a call transcript or an app view at hand, and returns to the thread with the same tabs left.

**How.** A click on a link to a file, block, commit, thread or site anywhere in the window; the "+" menu above the area and in the window row, ⌥-click on a thread in the column, ⌘I "ask", "Split right" in the palette; the `ShellOps.openPane`/`openThread(…, 'beside')` shell operation. The area header carries an "Open in …" icon for the active tab when its view declares a full place: file — in Files, block — in Knowledge, commit and thread Changes — in Git, browser page — in the system browser, thread — in Agents at the main slot (its tab closes). A thread beside has no header of its own: CLI-thread switches are thread-menu items. The icon is the place sign, words — in the tooltip: this leaves room for tabs in the bar; at the area's minimum width, a text button left room for only one tab.

**Behaviour.** Tab set, order, active tab and whether the area is open are per holder: thread, draft (passing to the born thread) and section without a thread; stored on the device. Width is one for the whole app and all windows. Reopening the same thing moves to its tab; a thread is never a tab of itself. A block and commit of another project stand beside just like one's own: the tab holds the graph of the copy where the thing stands and does not touch the window title. What an agent opened stands in the background with a mark in the layout of the screen showing its thread, otherwise in the thread's own layout. A vanished thing drops out of the layout. In a narrow window the area stays in place and squeezes to its minimum; ⌥⌘\ folds it.

**Limits.** One thing is visible; there is no column split. Layouts do not sync between devices, except terminals: their holder is stored in the project. The mobile shell opens a neighbouring thread in the main slot instead.

---
id: 01a156f2-58b7-7d3b-a306-b239c921de57
title: Return the branch/worktree bottom terminal panel beside the thread terminals in the right area
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a125fe-9260-7644-9a64-589c9bc19e19",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15644-1d84-7417-b2e0-1a158d1f8bb4
---
Operator's word: the bottom terminal panel returns as it was before `d5a9e19752`. Its terminals belong to the current branch/worktree, not the thread. Right-area terminals stay, the thread has its own. The two sets never mix.

**Bottom panel** — behavior before `d5a9e19752`:
- one per branch/worktree (place), visible from any thread of this place;
- its own tabs and splits, ⌘J shows and hides;
- "shown" state stored per place;
- ⌘T, ⌘⇧T, rename, close all, and tab switching work inside the panel.

The panel tab bar builds on the shared `TabRail`: never resurrect the old `terminal/TabStrip.svelte` (rule dd380bf6).

**Right-area terminals** — thread tabs (`terminal` view):
- "+ → Terminal" in the right area creates a thread terminal;
- an agent shell lands in the background as a tab in its thread's layout;
- never shown in the bottom panel, and panel terminals never in the right area;
- closing a thread tab closes its terminal like closing a panel tab: ask if a command runs, then terminate. No live terminal is left "in no tab".

Never return other threads' terminal lists or closed terminals to "+".

Proof:
- place-owner tests: a panel terminal never lands in a thread layout and vice versa; a place panel visible from two threads of this place; closing a thread tab terminates the shell;
- typecheck;
- Chrome check on its own `tagma:try`.

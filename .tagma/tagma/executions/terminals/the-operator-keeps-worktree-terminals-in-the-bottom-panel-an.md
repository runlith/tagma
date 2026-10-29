---
id: 01a14c14-6895-75c6-80f2-47ad00ee51b6
title: The operator keeps worktree terminals in the bottom panel, and their own thread terminals as tabs beside it; the layout survives reloading
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bae-6720-7d62-897a-928db50ae262
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47ae7cfc3462
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47af5283a9d6
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b0b84c2d57
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b2ec9cf08a
  - kind: relates
    to: 01a14c14-6895-75c6-80f2-47b3a24c4397
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/panes.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Panel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/PaneTree.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/TabView.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/worktrees/Terminals.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/worktrees/WorktreeTerminals.svelte.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/contract/wire/terminalBehavior.ts
    symbol: terminalPlaceLayouts
---
**Value.** The operator keeps their worktree shells at hand without leaving for a separate terminal app, and finds them in place after the window reloads.

**How.** The terminal bottom panel at the window bottom, under the page and the right area — shared for all threads of the current branch and present on every project page; shown by the button at the left end of the status bar, right under the panel — badge and running count — and ⌘J; "+" in its strip. A terminal only for the thread is the "Terminal" item in the right area "+": it stands as a tab by that thread and does not reach the panel. Underneath — `start_terminal` on the operator's behalf.

**Behaviour.**
- Each worktree and main checkout has its own panel; it shows the place from the page address (`?branch`), i.e. the place of the thread in focus. Showing an empty panel starts a shell; closing the last tab hides the panel.
- A thread terminal belongs to its thread: closing its tab stops the shell (with a question if a program runs in it). Terminals opened in a draft pass to the born thread; a deleted thread's terminal returns to the panel.
- Closing a panel tab stops its shell; if a program runs, Tagma asks (`terminal.skipCloseConfirm` removes the question), and if a CLI became a thread in the terminal, the question names that thread. Several closings in a row ask one by one.
- A stopped panel tab is remembered by the place: reopen restores its layout and headers with a fresh shell.
- A tab splits into panels right and down; panels align, expand, get a header, move to a new tab of the same holder. Tabs rename on double click.
- A call of a terminal not on screen marks its tab.
- A held terminal the agent started in the place becomes a background tab with the agent label at the holding thread; `?terminal=` opens it where it stands: in its worktree panel or by its thread.
- A held program on pipes — an agent background server without a screen — stands as a tab just like pty: its terminal shows output in arrival order, there is no input in it, size follows the tab, after the end — the outcome without Restart.
- Each place's layout, holders, closed-tab stack, and panel display the window writes to the project setting `terminal.placeLayouts`; other windows of the project pick up holders and headers from it. A terminal opened in another window appears in the panel at once.
- A temporary list-read failure needs no manual repeat: the window continues reading when the connection restores or a fresh host answer arrives in the live feed. Until the list is read, the kept layout is not rewritten.

**Limits.** An address outside every worktree of the project has no place. A CLI thread terminal stands in the thread itself. An agent command does not become a tab: its output is shown by a terminal in the feed card and in the thread operation popover.

---
id: 01a10891-853e-7f52-89f5-9e2d5c88840b
title: Thread panels beside the main content instead of the chat popup; the agents column can be hidden
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: relates
    to: 01a0c83f-4f47-72fe-9b6c-cf30e4e55579
sources:
  - kind: dir
    ref: packages/floating-frame
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/OpenFile.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Column.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/Dock.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/OnScreen.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/threads/PanelHost.ts
---
Thread panels open beside a section's main content. That can be two or three threads at once, a child next to its parent, or a conversation about an open block, diff or journal. The agents column can be hidden so the panels take the whole window. The floating chat popup (Dock) is removed: a panel does its job.

## Model

- **Main content is what the section route shows.** In Agents it is the thread from the URL, in Knowledge a block or the graph, in Checkout a checkout, in Journal the journal. Route and `Visits` work as now.
- **Side panels are threads right of the main content.** Up to three, independent of the section: moving from Knowledge to Checkout keeps the thread panel. That is exactly what the Dock gives now, only on top of the content.
- **Focus.** One panel is active: the main one or a side one. Keyboard, composer autofocus, worktree switcher, model meters and the worktree “frame” follow focus.
- **Saving.** The side-panel set and focus persist per project in localStorage. Switching projects shows that project's panels.
- **No duplicates.** One thread does not open in two panels: opening an already visible thread moves focus to it.
- **Width.** Panels split the width evenly by default, with draggable seams between them. A thread panel's minimum is 480 px (`CONVERSATION_MIN`). When there is no room, a new panel replaces the side panel whose focus is oldest.

## How to open

- `⌥`-click a thread in the list, or the row menu's `Open beside`. `⌘`- and `⇧`-click on a row are already taken by folder-layout selection.
- Clicking a child in the team button ([[54780672]]) opens it next to the parent.
- `⌥↵` on a thread in the palette ([[0ed5d929]]); “Ask Tagma” opens as a panel too.
- **`⌘I` — “Ask about this”** on a block, diff, journal or checkout. Opens a panel with a new Tagma-agent draft, with the object already mentioned in the draft through the same mention mechanism as the composer. `⌘J` is taken by terminals (`terminal/Keymap.ts`); `⌘I` is free in the app.
- Three actions in a side panel's title:
  - `Open as main` — move the thread into the main content, Agents section;
  - pop out into a window — outside this spec;
  - close. Closing a panel does not stop the thread.

## Hiding the agents column

- `ThreadColumn` gains a “hidden” state — an app-level service with localStorage, modelled on `Sidebar.svelte.ts`, plus `onCollapse` on Seam.
- Toggled by the button at the bottom of the rail and by `⌘\` ([[54780672]]). The header stays in place.

## How it is built

Builds on what exists:
- the Dock shows a second thread through a separate `HarnessHost` started in the project scope without `navigate` (`PanelHost`);
- the conversation subtree does not depend on the route;
- the layer provides `App.hold(rung, input)` — several scopes of one rung at once.

**New owner** — a panels model in `lib/app` (the app layer may import every feature). It holds the side-panel list, focus and saving. The root layout draws side panels right of `<main>`, so they survive section switches.

**Side panel**
- Starts its own `HarnessHost` in a child project scope without `navigate`, like `PanelHost` now.
- Wraps the subtree in `App.hold(ThreadRung, {id})` so thread-level services resolve for its thread.
- Draws `ThreadHeader`, `Conversation` and the composer. The changes column and terminals stay with the main content.

**What currently assumes one thread on screen, and goes multi-thread**
- `ThreadOnScreen` → the panels model's focus. Its readers — `UsageMeters`, `WorktreeSwitcher`, `worktrees/Chip`, `worktrees/acts` — read the focused thread.
- `ThreadList.seeOpenOutcome` marks every visible thread read.
- Anyone reading the global `ThreadRung.Source` directly moves to resolving through the held scope: `ThreadMain`, `FilesColumn`, the `ContextPanel` key in `Conversation`, chat layout. `OpenFile` moves from app level to thread level: the open diff belongs to the thread, not one for the whole app.
- `Worktrees.aimed` and the `?branch=` rewrite in the chat layout follow the focused thread.
- New-thread draft: main content uses key `new:<project>`, each side panel its own key. Currently all of a project's new drafts share one slot.
- Composer autofocus fires only in the focused panel. Window-level key handlers inside a conversation and a diff (`DiffPane`, `FilesColumn`) react only in their own panel.

**Draggable seams.** Seam computes the ceiling from the window (`share × innerWidth`), and panel names in `Panes` are a closed union. Kit Seam takes the ceiling from the container, plus keyed panel names. That is a kit fix [[e4e55579]], not an app-level wrapper.

**Removing the Dock**
- `HarnessDock`, `PanelHost`, `threads/Panel.svelte` and `HarnessOverlay` go together with the Dock branch of `ThreadOnScreen`.
- Kit `packages/floating-frame` is used only by the Dock and goes with module card [[ff4d995b]].
- The Dock's Library button already moved into the app menu ([[54780672]]).

**File size.** `View.svelte.ts` is 1331 lines: changes there must not grow it.

## Acceptance

- Two threads side by side. Each streams its own turn, each has its own composer and draft. Sending in one does not touch the other.
- A child opened from the team button stands next to the parent. Changes and `OpenFile` in the main content show the main-content thread, not the side one.
- `⌘I` on a block opens a panel with a draft mentioning the block. After moving to Checkout the panel stays.
- A hidden agents column and three panels take the full window width; the header stays.
- Page reload restores the panel set and focus of the current project.
- Dock and `floating-frame` are deleted; code search no longer finds them.

## Out

- Popping a panel out into a separate desktop window.
- Dragging a row from the list to the screen edge.
- Changes column and terminals inside a side panel.

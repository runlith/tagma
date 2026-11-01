---
id: 01a15733-ba94-72d4-9e93-90d81d4dd5b3
title: WorktreeTerminals stores which holder a terminal belongs to; the right-side tab is its projection, the bottom panel shows worktree terminals
ord: 14
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/terminal/Panel.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/worktrees/Terminals.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/worktrees/TerminalSettings.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/executions/worktrees/WorktreeTerminals.svelte.ts
---
Worktree terminals live in the bottom panel (`executions/terminal/Panel.svelte`), shared by all threads of that branch; the right area holds only its own holder's terminals. Belonging has a single owner — `WorktreeTerminals.holders`, written into the project setting `terminal.placeLayouts` together with the tab layout. A holder includes its layout project: section names are shared across projects, while a terminal can stand beside its thread in another project. The settings schema preserves both the holder and its project. The tab in the holder's layout (`TabLayouts`, device storage) is only a projection, and it is reconciled with the owner in both directions. After terminals are read, and whenever the settings catalog brings a new layout, `Terminals` lays a tab for every terminal that has a holder. The displayed threads' live execution inventory supplies their terminal projects, which the shell holds even before any device tab exists; a cold foreign project can therefore restore its owned tabs after a device layout is lost. Confirmation dialogs observe the live terminal owners across those projects. And a terminal tab belonging to another holder never stands in the shown layout (the terminal kind's `stands` compares the holder) and is swept from the stored one: an unsaved setting or someone else's layout never place one terminal in the panel and on the right at once.

A thread born from a draft declares a single source — the main slot's writer through `SidePanes.carry`: the draft's tabs move into the thread's layout, and `SidePanes.inherit` subscribers learn the heir regardless of what the device layout holds or whether the area is mounted — so the draft's terminals always pass to the born thread. Other holder changes are opening a terminal at a holder (`Terminals.lay`) and moving the panel out into its own tab: both write the holder into `WorktreeTerminals.holders` first and only then open the tab. A holder thread that is gone (`ThreadNames` answers `null`) does not count as an owner: the terminal returns to its worktree's panel instead of getting lost in a layout nobody will show.

A terminal a thread holds whose directory lies in no checkout of the project has no worktree and no panel: it stands in a separate holders' set (`Terminals.all`, a `WorktreeTerminals` with no root) and only as a tab of the thread holding it. Its belonging is the record's `heldBy`, laid again from each terminal reading, so the set is never written into `terminal.placeLayouts`, whose keys stay checkout roots. A new terminal asked for from such a tab starts in that terminal's directory under the same holder; once that holder is gone, the terminal opens nowhere and says so.

The current worktree has a single owner — the page address (`Worktrees.aimed`), which `FrameFollow` keeps at the focused thread's place. So opening a panel terminal in another worktree moves to that branch's draft instead of leaving another branch's thread on screen: otherwise `FrameFollow` would move the address back, and the terminal would open in an invisible panel. A held terminal opens its thread at the home read by identity, while the tab keeps the execution project's qualified address. Crossing projects carries that terminal intent in the route; the receiving view holds its execution project until the tab's own hold takes over. Rendering and closing resolve the execution project's live terminal owner, rather than the project displaying the conversation.

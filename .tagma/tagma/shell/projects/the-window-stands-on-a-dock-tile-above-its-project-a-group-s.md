---
id: 01a18da7-d528-7f21-b218-68e52e540ecf
title: "The window stands on a dock tile above its project: a group's members share one tile scope, which keeps the agent list across them"
ord: 6
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a18d49-eba5-7e14-8517-20f9249b762f
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/projects/Strip.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/holds.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/workspace/TileRung.ts
---
The window's ladder is tile, project, then graph and thread. The tile is the dock tile the window stands on: a project in no group, or the group whose member the window stands in (`Workspace.contextTile`). What a person keeps while moving between members — the thread list, its folders and folds, work lines — lives at the tile tier, and the agents column declares `stands: 'tile'`, so the shell remounts it only when the tile changes; Files, Git, terminals and the page stay project-scoped and move with the crumb.

A project scope stands under its tile: a component that holds another project's place goes through `holdProject`, which holds the project's own tile first, or the scope would open under the window's current tile and miss the place a later visit opens. Prefetch prepares the tile with the project and graph, and a switch counts as warm when the destination's tile scope stands.

The dock lists tiles derived from the stored project ids, so a group shows once, at its first stored member, its members show no tile of their own, and after the group dissolves each member's id brings its own tile back; a tile opens into the member last entered, else the first member. A tile's corner carries one mark per member, and its badge and crest sum the members' pulse (`ProjectPulse.of` on the group's id).

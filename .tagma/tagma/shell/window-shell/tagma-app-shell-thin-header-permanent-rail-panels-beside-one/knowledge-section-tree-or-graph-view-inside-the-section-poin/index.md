---
id: 01a10891-853e-7f52-89f5-9e2e46f2f6ef
title: "Knowledge section: Tree or Graph view inside the section, pointer column with filter, recents and tree, Map removed"
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/app/src/routes/[project]/map
  - kind: file
    ref: apps/tagma/app/src/lib/app/chrome/Sidebar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/spatial/MindMap.svelte
---
The Knowledge section is one rail item. The view switches inside the section: Tree or Graph. The section column becomes a real pointer: block filter, recents, tree, work in progress and saved views. Map is removed.

## What is there now

- **Rail.** Under the outline item a subgroup appears of equally drawn things of different nature: Map, Graph, Rules and the column button. On other sections it disappears, and the rail changes shape.
- **Column** (“Knowledge index”, `lib/app/chrome/Sidebar.svelte`) — two flat shelves: In work and Views. On runlith that is one row plus one more in 240 px. By default the column is closed, opened by the subgroup button.
- **Map** (`graph/spatial/MindMap.svelte`) expands all nodes on first open, and `fit()` has no lower zoom bound. On runlith's 1384 leaves the zoom is 0.011–0.018 — a pixel-wide strip. Operator: Map in its current form is useless.

## What we do

**Rail.** One Knowledge item ([[54780672]]). It is highlighted on the block page and on the graph.

**View switch** `Tree | Graph` — in the Knowledge column header. Tree is the current block page (`/b/<id>`, `/[project]`), Graph is the current `GraphView`. Switching keeps the current block: the open block becomes the graph focus and back.

**Knowledge column**, top to bottom:
1. **Filter blocks** — a field. While it holds text, a live `search_blocks` list for the project replaces the other sections.
2. **In work** — the current shelf: blocks with active work and a holder icon. Shown when non-empty.
3. **Recent** — the last eight opened blocks of the project. The block page remembers them on open: localStorage, per project, next to `Visits`.
4. **Tree** — the block tree from the project root on `ProjectTree` data, already loaded whole and live.
   - Rows are `outline/BlockRow` in compact form.
   - Expansion state is its own: key `tagma.sidebarExpanded.<project>`.
   - Resting states hide by the same rule as in the outline: `HiddenStates`, `tags.standsInOutline`.
   - The tree has the `tree` role and arrow-key navigation.
5. **Views** — the current saved-views shelf.

By default the column is open. Hidden by the button at the bottom of the rail and by `⌘\`, like the agents column. Width still held by Seam.

**Removing Map.** Going away:
- the `routes/[project]/map` route;
- `MindMap.svelte` and `maplayout.ts`;
- the `map` surface in `SURFACES`;
- the `map` key in `Visits`;
- the Map item in the palette's “Go to”;
- localStorage `mapDirection`;
- the `reading: 'map'` mode in `TreeScreen`, `foldsAway`, plus `closeAll` and `openBack` if only Map uses them.

Old `/…/map/<id>` links in browser history return “no such page”, like any unknown address. No redirect: we keep no second address form (rule [[acb620dd]]).

## How it is built

- `Sidebar.svelte` is rewritten for the sections above. The tree takes visible-children selection from `TreeScreen` (`visibleChildren`) or moves that rule into an owner shared by the outline and the column, but does not copy it.
- There is no virtualization in `outline/`. The column draws only expanded branches, and by default only the first level is expanded. On a project with thousands of blocks this bounds the DOM.

## Acceptance

- On runlith the column is open by default and shows In work, Recent, the first-level tree and Views. The filter finds a block by word.
- `Tree | Graph` switches the view without losing the open block.
- The rail has exactly five items on any section.
- Code search no longer finds `MindMap`, `maplayout` or the `map` surface. Typecheck and tests pass.

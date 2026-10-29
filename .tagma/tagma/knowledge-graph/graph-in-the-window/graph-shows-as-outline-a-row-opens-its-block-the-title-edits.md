---
id: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
title: "Graph shows as outline: a row opens its block, the title edits by Rename or F2 with outliner keyboard, filters and live changes"
ord: 1
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6932d9f44168
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6948b2fd65e7
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/FilterBar.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/BlockActionsMenu.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/BlockRow.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/Row.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/Tree.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/OutlineSection.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/ProjectTree.svelte.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/ReadingLens.svelte.ts
    symbol: ReadingLens
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/TreeScreen.svelte.ts
    symbol: TreeScreen
---
**Value.** The graph is written mostly by agents, while a person reads, finds, and opens it. Outline gives him a tree where every row opens its block, and an ordinary outliner when he writes and rearranges blocks himself from the keyboard. Filters narrow the tree by tag and state, and agent edits show live, with no page reload.

**How.** The project page shows the whole graph's outline; any block's page shows its subtree's outline.

**Behaviour.**
- A row stands on one grid at every depth: the expand chevron in its own column, the tag's icon as the row's one mark, the title, and the facts at the end — child count, holder, blocking indicator, a square state tile when its tag has a lifecycle, and freshness on work that is not resting. A branch's line runs from the centre of its parent's icon. The title stays one line, fading at the edge, until it is edited.
- The whole row is a link to its block by the general link rule. In Knowledge a click and Enter go to the block page, while Cmd-click opens it beside in the area's right tab. In the block's right-area tab a click opens beside, and Cmd-click in the full place. Right-click in both places opens the row's own menu, the same as its ··· button: the block's acts, the places to open it with the gesture each takes, copies and delete. A row's own buttons — expand, actions menu, status, holder — never open the row. The title text is not selected with the mouse.
- Title editing is an explicit act: Rename in the block menu or F2 on the focused row. Esc and focus loss leave editing and save.
- Editing runs the writer mode. Enter starts the next block with the same tags, already editing. Arrows at a row edge move editing to the neighbour. Tab and Shift+Tab nest and unnest, Alt+arrows shift, Ctrl+arrows collapse, Backspace in an empty row deletes the block and moves editing to the previous one. A new block from "Add block" or "Add child" is born editing too. The menu offers only tags whose node is created with one title.
- Tag and state filters, including "done" and "blocked", and neighbour order are remembered in the browser. Ancestors of matching rows remain visible under a filter.
- Resting blocks hide by default; settings change that.

**Limits.** A server refusal of an edit arrives as a notice, while the row stays as it was.

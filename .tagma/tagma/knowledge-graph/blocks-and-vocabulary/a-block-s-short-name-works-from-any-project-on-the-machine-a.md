---
id: 01a14bc5-0df5-77c8-b1a2-692dbb2a8aea
title: A block's short name works from any project on the machine, and a [[name]] link in a body shows its live title
ord: 3
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-692e4ad9de5e
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69386eea6577
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6948b2fd65e7
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-694b05354451
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/BlockTitles.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/markdown.ts
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/references.ts
  - kind: symbol
    ref: apps/tagma/app/src/lib/features/graph/blockRefView.ts
    symbol: blockRefView
  - kind: symbol
    ref: apps/tagma/server/src/graph/operations/crossing.ts
    symbol: locate
  - kind: symbol
    ref: apps/tagma/server/src/graph/serving/routing.ts
    symbol: titlesAcross
---
**Value.** A block's short name works everywhere: in any operation, in any project on the machine, in agent text, and in another block's body. A `[[name]]` link always shows the current title, so renaming breaks nothing.

**How.** The name is the tail of the block id; every reading prints it. Bodies write `[[name]]` or `[[name|own words]]`; in an agent message a block whose name stands in several projects is written as `[[<project id>/name]]` — the feed draws it with the same link. A body never carries the address: a project id is local to the machine, so recording such a body refuses and names the bare name that resolves in any project. `read_titles` resolves a name list into titles. In the app the name copies from the block menu and from the block page.

**Behaviour.**
- The name is looked up first in the calling graph, then in the Tagma graph, in global, and in every registered project. The act over the found block runs in its own graph.
- Links index both ways: reading a block shows who references it.
- The app draws a link with its live title and opens the project copy where the block was found: a click opens the block as a right-area tab with that copy's graph, ⌘-click as a Knowledge page in a diff lens over the same range; right-click gives the link menu. Links in a body on the Knowledge page open the same way. When the name exists nowhere, the link marks as nonexistent.

**Limits.** A link is navigation, not an edge: a link between blocks, including across projects, is recorded by `relates`. When one name fits several blocks, the call refuses and lists the candidates with long tails. Copies whose index failed to read during search are named in the answer. Search reads copy indexes, not their files: a copy the server never opened yet takes no part, and a cold copy answers with what it knew when last opened.

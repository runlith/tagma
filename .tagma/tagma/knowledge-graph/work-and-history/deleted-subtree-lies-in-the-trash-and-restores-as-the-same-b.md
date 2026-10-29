---
id: 01a14bc5-0df5-77c8-b1a2-69419b982509
title: Deleted subtree lies in the trash and restores as the same batch
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-693ed42057f8
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-69423f034f23
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6947519b9f89
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/outline/Tree.svelte
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/TrashedBlock.svelte
  - kind: symbol
    ref: apps/tagma/server/src/graph/blocks/trash.ts
    symbol: trashLayer
  - kind: symbol
    ref: apps/tagma/server/src/graph/cli/blocks.ts
    symbol: blocks
---
**Value.** Deletion is not scary: a block leaves for the trash with its subtree and returns as the same batch, with its place and links.

**How.** `delete_block`, `restore_block`, `list_trash`, the `tagma trash` CLI. In the app deletion comes from the block menu or keyboard in outline. The last deletion undoes from a notice or hotkey; the trash list lies under outline; a deleted block's page offers restore.

**Behaviour.**
- A deleted entry vanishes from every live reading.
- Exactly the batch that fell together restores, by the journal record.
- A block whose file vanished from the graph tree or was taken by a file with another id lands in the trash too.

**Limits.** Nothing empties the trash: deleted entries lie until restored or until the project itself is deleted. The project root, a subtree with a module, and a tag held by a catalog are never deleted. Only the batch root restores, and only under a standing parent.

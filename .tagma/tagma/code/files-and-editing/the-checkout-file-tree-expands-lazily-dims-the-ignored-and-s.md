---
id: 01a14c13-c481-7acc-8aa6-03c2ecf2e826
title: The checkout file tree expands lazily, dims the ignored, and shows git letters and holder dots
ord: 4
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c3d1f6564f
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c4281cc328
  - kind: relates
    to: 01a14c13-c481-7acc-8aa6-03c5f4dbd608
sources:
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/listing
  - kind: dir
    ref: apps/tagma/server/src/checkout-files/tree
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/Explorer.svelte.ts
  - kind: file
    ref: apps/tagma/app/src/lib/features/checkout/files/ExplorerView.svelte
  - kind: symbol
    ref: apps/tagma/server/src/checkout-files/contract/wire/directory.ts
    symbol: DIRECTORY_OPERATIONS
---
**Value.** The operator browses code like in an IDE and at once sees which files changed and by whom.

**How.** The Files column on the Checkout page — the default view, Cmd+Shift+E; the `read_directory` operation and a live tree-changes subscription.

**Behaviour.**
- A directory reads on expansion, in pages: directories first, names in natural order; a large directory is read on with a "More" line.
- Git-ignored is dimmed but not hidden; `.git`, `.DS_Store`, and the graph store aren't shown. A symlink is named with its target: inside the checkout, outside, or broken.
- A changed file has git's letter and color plus holders' dots in their shades, with a tooltip of who wrote how much; a directory with changes inside is marked.
- On-disk changes re-read only expanded visible directories; while a name is being typed or dragged, they accumulate.
- The active tab is revealed in the tree; typing letters while the tree has focus moves to the matching row.

**Limits.** An off-checkout symlink target shows but doesn't open. The tree is the operator's door only; the agent lists directories with `ls`.

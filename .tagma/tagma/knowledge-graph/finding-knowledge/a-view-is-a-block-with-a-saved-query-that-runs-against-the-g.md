---
id: 01a14bc5-0df5-77c8-b1a2-6937cc0e28a3
title: A view is a block with a saved query that runs against the graph now when opened
ord: 5
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6948b2fd65e7
  - kind: relates
    to: 01a14bc5-0df5-77c8-b1a2-6949e55dee89
sources:
  - kind: file
    ref: apps/tagma/app/src/lib/features/graph/block/ViewResults.svelte
  - kind: symbol
    ref: apps/tagma/server/src/catalogs/contract/wire/coreLibrary.ts
    symbol: view
  - kind: symbol
    ref: apps/tagma/server/src/graph/contract/wire/query.ts
    symbol: viewLayoutSchema
  - kind: symbol
    ref: apps/tagma/server/src/graph/reading/selectionBehaviour.ts
    symbol: selection
---
**Value.** A repeated question to the graph gets a durable address. Opening a view means running its query now, so nobody keeps a list by hand and it never goes stale.

**How.** A block with the `#view` tag (or its own tag with a selection contract) with a saved query. Reading such a block runs the query. The view's page in the app shows results as one list, sections, or columns by status, tag, or parent.

**Behaviour.**
- The layout chosen on the page saves into the view itself.
- When a block from the query area is deleted, the view returns an empty result and names the missing names.

**Limits.** A view is a leaf: no block stands under it. Reading a subtree never runs views.

---
id: 01a1369b-24c0-7f0a-ac26-731c9cd335df
title: The block file carries edges to trashed blocks, and one owner renders its text
ord: 4
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a12cce-dcee-72ca-9826-a33562d9a6f4
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/tree/connections.ts
  - kind: symbol
    ref: apps/tagma/server/src/graph/tree/export.ts
    symbol: rowText
  - kind: file
    ref: apps/tagma/server/src/graph/tree/edgeRows.ts
  - kind: file
    ref: apps/tagma/server/drizzle/20261102110000_unbound_edges/migration.sql
  - kind: symbol
    ref: apps/tagma/server/src/graph/store/tables.ts
    symbol: unboundEdge
  - kind: symbol
    ref: apps/tagma/server/src/graph/steps/sequence.ts
    symbol: GRAPH_STEPS
---
Tree reads into the mirror resolve an edge uuid to a trashed block too: repair looks for the target among all project rows, and rebuild among the scan and the saved trash. `Trash.delete` keeps the rows' edges so `restore_block` returns the block with them. So the holder's file carries the edge to a trashed block. If the file did not carry it, the mirror would stop being derivable from files: a holder repair or rebuild would wipe the edge, and the restored block would return without incoming edges. Graph reading (`read_block`) hides such edges: it is a filter over the truth, not part of it.

A fresh mirror may lack the target's trash, but the file's local edge address still survives projection as an unbound edge. It is not a live relation and creates no placeholder block. When a later file arrival supplies the target, mirror repair binds the stored address; rebuilding also resolves it against saved trash. Otherwise format adoption could silently erase a relation that the receiving graph still needs when restoring its target. The format step rereads existing mirrors from files and prevents older writers from changing the shared tree, since they cannot preserve these addresses.

One owner renders the block file's text from the mirror rows: `connectionRows` picks edges, sources, and the carried session-field spelling (for full projection — on live holders), `groupConnections` groups, `rowFrontmatter` and `rowText` assemble frontmatter and text. Full projection (in a worker), the act projection, and restore (`encodedFiles`) use them, plus the ledger. There used to be three renderers, and full projection dropped an edge the delta wrote: every `rewrite_graph_files` and twin bring-up changed the file, and the ledger counted it as externally changed.

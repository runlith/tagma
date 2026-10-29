---
id: 01a159e6-fa8d-7c55-84a2-e8770747eba6
title: An edge into another graph lies in the same to row of the block file as a <graph root>/<uuid>#<label> address, not a separate key
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/graph/contract/wire/far.ts
  - kind: file
    ref: apps/tagma/server/src/graph/steps/farEdges.ts
  - kind: file
    ref: apps/tagma/server/src/graph/tree/connections.ts
---
The graph address is its root block's uuid: it travels over the same git as the blocks and matches in every clone, while a colleague's path, `repoKey`, and remote differ. A separate key next to `to` would make the file unreadable to an old server: frontmatter parses with `onExcessProperty: 'error'`. A `to` row matching no uuid is moved by the old server into `deadEdges`, which keeps reading. Its projection would erase such an edge — the file text renders from the mirror, which holds no edge — so the `20261020150000_far_edges` shape step translates nothing and only raises `format.json`: a server that does not know the step serves the graph for reading and refuses writes.

The label is the target root's title at bind time; it names a project missing from the machine, and reads never refresh it, or they would rewrite someone else's files. Parsing turns one's own root address into a plain edge, and writing such an edge always takes the local form.

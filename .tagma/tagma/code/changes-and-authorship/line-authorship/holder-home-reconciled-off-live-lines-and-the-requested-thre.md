---
id: 01a1283c-d7db-737d-b17b-0792bbb240d4
title: Holder home reconciled off live lines and the requested thread, with no history pass at Store.open
ord: 22
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126fe-89ef-775e-a2db-fe589426f45c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-422205931ea8
  - kind: implements
    to: 01a12699-1673-714b-a6a5-79ec9631d38c
---
Drop the full workspace_change UPDATE from 20261010185630_change_holder_home: it forces the snapshot to read and copy the whole edit history. Keep the split between a line's project and the holder home, reconciling writing/held narrowly at start and finished lines by holder before reading their history. Verified: 2 integration tests keep foreign-holder and deleted-holder, refuse an ambiguous checkout atomically, and re-reconciliation passes under markReadOnly. Scoped typecheck passed. An APFS clone with 231735 workspace_change rows opened all 8 trailing migrations in 635.6 ms; writing/held reconciled by 3111.4 ms, store closed by 3142.3 ms. One sample of this machine. Delivery — 0ee1b7b672; the full rehearsal rerun carries out [[2d1f5572|refresh task]].

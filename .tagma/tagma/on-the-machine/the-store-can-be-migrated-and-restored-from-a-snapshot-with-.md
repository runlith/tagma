---
id: 01a14c05-71a7-71c8-88a1-ee51b44224b6
title: The store can be migrated and restored from a snapshot with the server stopped
ord: 24
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14bc0-7683-7815-8eed-9d3717c9c033
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee5201606b20
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/cli/database.ts
  - kind: file
    ref: apps/tagma/server/src/composition/snapshots.ts
---
**Value.** A developer or maintainer restores the store when the working server does not start, and can separately run pending migrations.

**How.** `tagma db migrate`, `tagma db restore-snapshot`.

**Behaviour.** Both acts take exclusive ownership of the data directory, so they work with the server stopped. Migration uses the machine database's owner; a snapshot restores the pre-migration slice prepared together with the participating file data. A missing rollout demands explicitly accepting exactly the named loss. Migration without a snapshot also demands an explicit choice.

**Limits.** These are technical offline acts, not a universal backup and not a release-return button. Migration does not pick an arbitrary graph mirror database: the graph's owner runs it at opening. Restore is limited to the saved snapshot and this installation's directory.

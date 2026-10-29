---
id: 01a0e532-cb92-7c35-bf59-cd3f79da54c4
title: "executions M3: closed"
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0e841-ca11-7a40-8e66-55d3d1aba29c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-cb8a-7bef-9a85-b3ffc595c5f9
---
§7.2.2 milestone `M3` of the `executions` card ([[f7e0b9dd]]), with its vocabulary amendment [[08edfbc5]].

The request-key table and tally renames must not copy, drop or rewrite history-sized rows. For a pure rename use SQLite's in-place `ALTER TABLE … RENAME TO` or `ALTER TABLE … RENAME COLUMN`, whose cost follows the schema rather than the history. If a type, constraint or dropped-column change prevents an in-place rename, use the card's TypeScript/Drizzle name while keeping the old physical name until the pre-release migration squash [[57330581]] creates the fresh schema. Apply the same rule to any other history-sized table in this milestone.
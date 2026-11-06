---
id: 01a1ae21-c461-7363-b5a2-3c0197def847
title: The step-back law names a migration that deletes or blanks rows of an existing table, whatever back.sql stands beside it
ord: 52
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: relates
    to: 01a1ad3a-f940-7727-920c-1581a3d3b323
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/migrationLaw.ts
---
Once a `back.sql` stands, `stepBackLosses` judges only renames: `DELETE FROM notes WHERE kind = 'old'` or `UPDATE notes SET body = NULL` with a `back.sql` of `SELECT 1` passes the commit gate and the cut, though those rows exist nowhere after the migration. A reversible rewrite is what `back.sql` is for, and the law cannot tell one from a loss by reading SQL. The design has to decide how a deleting migration keeps what it removes (a kept table the back script reinserts, or aside `tables` with a restore the kit does for rows, not only columns) and what the law checks. Done when such a migration is refused unless what it removes comes back on a step back.
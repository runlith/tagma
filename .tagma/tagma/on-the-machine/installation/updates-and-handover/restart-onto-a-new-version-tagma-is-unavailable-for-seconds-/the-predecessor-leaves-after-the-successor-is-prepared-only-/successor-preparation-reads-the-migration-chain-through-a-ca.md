---
id: 01a12815-a07f-7e53-ac47-70f8a604c232
title: Successor preparation reads the migration chain through a cache keyed by the `current/drizzle` path, and after `current` switches it refuses on a stale chain
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126fe-89ef-775e-a2db-fe589426f45c",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126b9-6a5d-780b-8049-4228220321a5
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/chain.ts
---
The predecessor reads the new installation's migration chain through `chain()` in `platform/store/chain.ts`, which caches what it read in a module-level `Map` keyed by folder string. On restart the folder is called `<install>/current/drizzle`: the same path under any installation `current` points to. After the first read (including a refused restart) the process sees for the rest of its life the chain that lay under `current` then.

Seen on one's own instance (`tagma:try` on one's own root): `restart_server` answered 409 `MigrationChainInvalid … 20261010115509_baseline: applied from different text` while the file under `current/drizzle` was already byte-equal to what was applied (sha256 matched `__drizzle_migrations.hash`); a fresh process with the same files passed the check and restarted.

To do: read the chain by the installation's real path (`realpath` of the folder) or stop caching the read that successor preparation does; a cache keyed by a string that does not name the installation must not survive a `current` switch. Proof: a test where the chain under one path changes between two preparations and the second one sees the new chain.

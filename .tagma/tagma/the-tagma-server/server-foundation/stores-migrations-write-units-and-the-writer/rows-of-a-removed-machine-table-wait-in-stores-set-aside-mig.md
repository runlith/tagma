---
id: 01a195b9-c52c-7da9-a023-4462899da1e8
title: Rows of a removed machine table wait in stores/set-aside/<migration>.sqlite, rewritten whole by the migration, until a module store adopts them after the door
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d03-7a6a-76e4-9fa2-6c3b9e8adf53
  - kind: relates
    to: 01a19464-5da9-72ce-aa52-6e9c55501889
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/aside.ts
  - kind: file
    ref: apps/tagma/server/src/composition/extensions.ts
---
A machine-store migration declares the tables it removes in `aside.json` beside its `migration.sql`. Before that migration's transaction, the opening store attaches a temporary file, copies each declared table whole, detaches it and renames it to `<data>/stores/set-aside/<migration>.sqlite`. The copy runs outside the migration's transaction because SQLite refuses ATTACH inside one; the rename is flushed before the migration commits its drop, so no committed drop exists without the file.

The file is rewritten whole on every run of the migration, never appended to. A transition attempt copies only the databases standing directly in `<data>/stores/`, so a rollback returns the machine database with the tables but leaves the set-aside behind; the predecessor may then write more rows, and the next run replaces the stale file instead of merging into it. A world transfer carries the whole `stores/` tree, set-asides included.

A module store names the migrations whose set-aside it adopts (`adopts` on its `stores` entry), and composition runs `Store.adopt` for each only after `Maintenance.opened`, when no rollback can follow. Adoption inserts every row of every table in the file into the same-named table of the module store in one transaction, skipping rows whose key the target already holds, and deletes the file only after that commit: a run interrupted before the commit leaves nothing, one interrupted after it finds every row already present. That is why a target table with no primary key or unique index is refused: a repeat would duplicate its rows. A set-aside nobody adopts stays where it lies, for a build that carries its module.

The attached file and the transaction share one connection: a store's statements and transactions both run on its single writer connection, and its readers never see the attachment.

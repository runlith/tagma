---
id: 01a195b9-c52c-7da9-a023-4462899da1e8
title: What a migration removes waits in set-aside/<migration>.sqlite until no standing installation lacks that migration, and a step back puts it back
ord: 1
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a13d03-7a6a-76e4-9fa2-6c3b9e8adf53
  - kind: relates
    to: 01a19464-5da9-72ce-aa52-6e9c55501889
sources:
  - kind: file
    ref: apps/tagma/server/src/composition/extensions.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/aside.ts
  - kind: symbol
    ref: apps/tagma/server/src/installation/process/returning.ts
    symbol: asidesReleased
---
A migration declares in `aside.json` beside its `migration.sql` what it removes: `tables` are copied whole before it runs, `derived` names tables whose rows the build before rebuilds itself, so nothing of them is kept, and `moved: true` says the kept tables go on into a module store. Before that migration's transaction, the opening store attaches a temporary file, copies each kept table, detaches it and renames it to `<store directory>/set-aside/<migration>.sqlite`. The copy runs outside the migration's transaction because SQLite refuses ATTACH inside one; the rename is flushed before the migration commits its drop, so no committed drop exists without the file.

The file is rewritten whole on every run of the migration, never appended to. A transition attempt copies only the databases standing directly in `<data>/stores/`, so a rollback returns the machine database with the tables but leaves the set-aside behind; the predecessor may then write more rows, and the next run replaces the stale file instead of merging into it. A world transfer carries the whole `stores/` tree, set-asides included.

**A step back puts it back.** The return of a store hands the kit the set-aside of each leaving migration — the fresh copy before an adopted one — and the kit restores them newest first inside the same transaction: a table the leaving store lacked gets its rows, a column it lacked is filled by primary key on the rows still standing, so a row deleted after the drop stays deleted. A dropping migration therefore loses nothing on the way back, which `back.sql` alone could not promise: once the migration ran, the data exists nowhere else.

**It stays until no installation reads what was removed.** Each start of an installed build with no step back asked releases a set-aside once every standing installation carries its migration — pruning removes the last release that lacks it, and the next start lets the copy go. A moved copy not yet adopted stays for its adopter whatever stands. A running build that lacks the migration keeps every copy of it.

**Adoption.** A module store names the migrations whose set-aside it adopts (`adopts` on its `stores` entry). Composition opens that store with the files and `Maintenance.opened` as the moment to start, when no rollback can follow, and the store adopts them itself. Adoption inserts every row of every table in the file into the same-named table of the module store in one transaction, and only after that commit renames the file to `<migration>.adopted.sqlite`, kept for a step back. A run interrupted before the commit leaves nothing; one interrupted after it finds every row already present.

Identity is the target's primary key alone. The conflict clause names exactly those columns, so a clash on any other unique index raises and the file stays, instead of a row being silently dropped and its only copy lost. A target with no primary key, a key column the set-aside lacks, or a set-aside row with an empty key is refused for the same reason: SQLite would allocate a fresh rowid or let NULL keys pass, and a repeat would duplicate rows. Foreign keys are deferred to the adoption's commit, since the file's tables arrive in name order, not dependency order.

Installation lifetimes are built over a module store before the door opens, so they can see it before its set-aside rows have arrived. `Store.adopted` resolves once every adoption of that store has ended, and answers whether every set-aside landed: true when each file was adopted or absent, false when any adoption failed. A failure is logged, and the file is kept for the next start. A module that reads its store to build state it keeps, such as a cache or an index, waits on it first, and one that would remove anything because its row is absent does so only when the answer is true: until then the missing rows may still be in a set-aside.

The attached file and the transaction share one connection: a store's statements and transactions both run on its single writer connection, and its readers never see the attachment.

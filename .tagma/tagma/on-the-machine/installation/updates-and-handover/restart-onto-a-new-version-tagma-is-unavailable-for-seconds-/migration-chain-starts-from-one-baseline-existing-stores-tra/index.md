---
id: 01a12699-1673-714b-a6a5-79ed842e3529
title: Migration chain starts from one baseline; existing stores translated to it once
ord: 7
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: dir
    ref: apps/tagma/server/drizzle
---
Tagma stores have one baseline migration with the current schema. The old 350 migrations, their data steps and reports are deleted, and existing stores translated once to the new ledger record. Done now and repeated while the user is single: what accumulates collapses into the baseline again. From the first build given to anyone else, the chain freezes, and every foreign store walks it whole.

## What makes the baseline

- **Schema — a `sqlite_master` dump of a store built by the old chain:** rows with non-empty `sql` and no `sqlite_` prefix (this cuts auto-indexes, `sqlite_sequence`, `sqlite_stat1`) and no FTS service tables. Operators split with `--> statement-breakpoint`, or trigger bodies tear. The drizzle TypeScript schema cannot give it: it knows no 30 triggers, FTS5, expression indexes or generated columns.
- **Rows seeded by migrations:** `meta`, `terminal_request_key_tally`, `d4_report`, `spent_epoch`.
- **`snapshot.json`** of the old chain's last migration, so drizzle-kit builds following migrations from the baseline. Whether drizzle-kit accepts it is unchecked.

The baseline adds no columns or tables: its schema equals the old chain head's schema.

## What the baseline covers

- **Machine store and graph mirrors.** The chain is one for them (`composition/start.ts:69-70`): each mirror carries the full schema and its own ledger. A mirror is not a cache: it holds the graph journal (`event`), and mirror rebuild never restores it.
- **Activity** — its own 11-migration chain; flattened the same way. Its file holds a bounded hours window and is recreated on translation.
- **Performance** — telemetry; its store is recreated, and the shape number leaves it ([[717de45f]]).

## Before translation

Translation is possible once nothing on the machine is left in the old shape:

- **Reachable rollout files already formed by the old build**, and SQL threads walked the collapsed chain's data steps. Passed shape steps deleted; new body changes go with `ThreadFormStep`s. A [[01a0bb7d-ecb0-70a2-9a42-964dd34f7446|thread without a rollout file]] (project 5) has the SQL unload mark `rested_at=1790479400313`, and no `thread_event` or `thread_entry` rows: the missing file gives the standing typed refusal `RolloutUnreadable`. Its content is not claimed checked and never restored by assumption. A thread with no unload mark and a journal in SQL reads from SQL as before.
- **A mirror's lag is proven by its correct ledger prefix below the slice.** The mirror holds the project journal for a branch or worktree, so another open refusal never proves it deletable. A full ledger with an allowed reorder inside an equal-time group is translated and kept on exact schema match.

## Translating existing stores

One action from the operator — an ordinary update with restart. The new build itself translates on first store opening.

1. **The baseline is sliced by the operator's store, not by main head.** The slice is his live store's ledger head at merge time. Old-chain migrations after the slice never collapse: they stay ordinary migrations of the new chain after the baseline, with the same names and hashes. Otherwise the single update would hit a refusal whenever his store lagged main.
2. **Opening recognizes the old chain to the slice and the applied tail.** Between `folderMillis` groups, derived by the chain owner, order is strict; inside a fully applied equal-time group the exact name/hash set matches with no repeats, gaps or foreign rows. Schema strictly matches the slice fingerprint and the actually applied tail prefix. An incomplete tail group is accepted only in the order and composition the receipt fingerprints exactly. Translation replaces only rows to the slice with one baseline record, keeping applied tail rows; the missing tail runs as the new chain's ordinary order. The pending-migration count check at the predecessor uses the same compare by reading only.
3. **Only a proven-lagged old-chain prefix is deleted.** The ledger-compare owner states this fact with a separate typed refusal, and the walk names the deleted mirror in the log. A correct ledger prefix below the slice, including an incomplete equal-time group, is deleted without checking its schema; losing the unique `event` journal in such a mirror is the accepted price of that deletion. Mismatched hash, order between times, a schema of a mirror that reached the slice, an unknown incomplete tail group and other refusals keep the mirror, WAL, shm and snapshots with the exact cause; the walk never reproduces the compare and never parses error text.
4. **The snapshot with collapsed-migration names is deleted after the ledger-translation commit:** on a transaction refusal it is kept, and an interrupted deletion finishes on the next opening. An ordinary tail snapshot is never taken by translation.
5. **The thread-list row** fills for SQL-lying threads — [[c3af42eb]].
6. **Tail body shape.** A journal body change goes as a `ThreadFormStep` on decode and thread access, with no data step in store opening and no mark reset. In the current tail the law translation into the project map is declared by guidance as one such step.
7. **Translation checked upfront.** Before the operator is asked to update, the slice is rechecked against his live store by reading only, and the translation itself checked on store copies in its own instance. An update after which the server never came up is not allowed here.
8. **This code is permanent.** Collapsing repeats before every release ([[f8616748]]): opening translates the ledger to the new baseline, and a store below the baseline refuses `BaselineNotReached`, naming the release from the baseline receipt.

Ledger rewrite is O(1) per store; list-row fill is one query per SQL-lying thread.

## What leaves with the chain

- 350 migration directories; the `drizzle` directory in the install stops weighing 61 MB.
- `steps`, `formedSteps` and `reports` in module manifests and their execution in `Store.open`.
- Opening "to the named migration" (`through`) and the `chain` field in `registry.json`.
- Type-index reverse: `reverseStore`, `tagma db reverse-type-index`, `__drizzle_reversals`.
- About 30 `*Migration.itest.ts` tests tied to old migration names; the chain, snapshot and registry-recovery tests rewritten for the baseline.

## What changes in rules

Cut conditions split machine migrations and portable shapes: `machine-store` migrations carried by the last published release collapse into the baseline; graph steps and journal shapes stay between releases. Why the split is described in [[f8616748|stored-shape machinery]].

## What the implementer proves

- Before deleting the old chain: a store created by the baseline migration matches a store built by the old chain schema — object by object over `sqlite_master`, with seeded rows.
- A copy of a store with the old chain to head opens with the new build, and its ledger is one baseline-migration row; a store with an old ledger short of head gets a refusal.
- Translation-condition check on the operator's live store, by reading only, passes.
- The next migration builds from the baseline and applies to a translated store.

**The operator's one step:** update with restart once all the work is done. No rollback to a pre-baseline build after it: it refuses to open the store.

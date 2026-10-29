---
id: 01a12699-1673-714b-a6a5-79ec9631d38c
title: Migration never touches history tables; key check and snapshot cost what it wrote
ord: 6
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/keyPlan.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/snapshot.ts
  - kind: file
    ref: apps/tagma/server/src/platform/store/statementTarget.ts
---
Opening a store with pending migrations costs as schema, not as history: a migration never touches history tables, it has no data steps, and foreign-key checks and the pre-migration snapshot run only over what it wrote.

## Where the time goes now

Two long opens by `serve.log` (one machine, ~20 GB store):

| Launch | `runtime composed` | Pre-migration snapshot | Migrations |
|---|---|---|---|
| Oct 2 | 981.5 s | 655 s (22 tables with data) | 322 s, of which ~290 s — `PRAGMA foreign_key_check` over the whole store; the `UPDATE`s themselves — ~30 s |
| Oct 9 | 663.7 s | 311 s (13 tables) | ~350 s, of which 243.6 s — five shape steps, each walking the whole journal anew |

- **Snapshot** (`platform/store/snapshot.ts:245-346`) walks touched tables four to five times: witness hashes every row, `dbstat` measures room, then copy and file sha256. If a thread-journal table is touched, the rollout participant hashes every file in `~/.tagma/threads` twice (`threads/journal/rolloutSnapshot.ts:89-97,121-127`). A small-table snapshot is cheap: 0.3 s in one measurement.
- **Key checks** fall to the whole store in three cases: a written table has any trigger (`platform/store/chain.ts:149-158`), the operator never parsed (`chain.ts:121-129`), a parent is written — then every child table is checked whole (`platform/store/keyPlan.ts:44-47`). 36 tables reference `thread`, including the whole journal. A migration of one `UPDATE` over 3.2K `thread_mandate` rows ran 133 s, of which ~130 s — whole-store key checks; that table's trigger is declared on other columns and never fired.
- **The migrations themselves:** of the last 100 (Oct 1–10) 22 cost as history — 14 rewrite journal-body shapes, 7 build an index on a history table, one updates a small table reading the journal.
- **Graph mirrors** migrate and snapshot after the door opens, on first touch: 15 mirrors in 15 s in one sample.

## Law

Tables split into two classes, and the class is declared by the table owner in the module manifest, beside its declaration:

- **history table** — a row appears on work events: message, journal event, call, command, transition, touch;
- **entity table** — a row per thread, block, project, account, setting.

An entity-table migration reads and writes freely: a full `UPDATE` over a few thousand rows is milliseconds. For history tables:

1. **Only `ADD COLUMN`** with no `CHECK`, with `NULL` or a constant default (including a virtual generated column), **and trigger create and drop, are allowed.** Rename is forbidden: the snapshot plan copies renamed-table data (`platform/store/snapshotPlan.ts:153,166-182`).
2. **Any other operator naming a history table in its text is a refusal,** including a read from an operator over an entity table. The check is conservative and never parses reads: the `platform/store/statementTarget.ts` classifier knows only the write target, and for reads a table name among the operator identifiers is enough.
3. **An operator that failed to parse is a refusal.**
4. **A foreign key from a history table to a parent with no index on the key columns is a refusal:** a child trial with no index is a full pass (`platform/store/keyCheck.ts:173-186`).
5. **A migration has no data steps.** Stored body shapes change with per-thread shape steps — [[8d4a4eb8]].

The law becomes a project rule and is checked where other rules are: on landing a change, over new chain directories. The refusal names the operator and the table.

`Store.open` never judges the law, but never walks the whole store either: an operator it cannot parse gives a typed open refusal instead of the current whole-store check.

## Key checks

The check plan builds from what the migration wrote, down to columns:

- a parent is checked only on `DELETE`, `REPLACE` and key-column `UPDATE`s it is referenced by;
- a child — only on `INSERT`, `REPLACE` and foreign-key-column `UPDATE`s;
- what triggers wrote is answered by the consequence walk already in `platform/store/writes.ts`; the third output of the same fact in `chain.ts` is deleted;
- the whole store is never checked. A long-standing dangling reference in an unrelated table never fails opening again.

## Snapshot

The snapshot code never changes: under the law it becomes an entity-table snapshot by itself, and the rollout participant never enters it, because journal-table data is never touched by a migration.

## Declared heavy update

A change the law forbids (index on a history table, rename, rebuild, data move) is possible only as declared:

- the migration carries the author's "heavy" mark with a cause; the law check lets it through and names it in the answer;
- before the predecessor leaves, the update is named to a human as long — [[9b246531]]. The estimate comes from `max(rowid)` of touched tables on this machine, and if the thread journal is touched — also from rollout-file sizes, which the snapshot hashes twice;
- in the window it shows the step and elapsed time — [[6417e7fa]];
- runs handed to the successor never break on the deadline that judges an abandoned run (now 20 minutes, `threads/contract/wire/rhythm.ts:21-25) while it runs;
- the snapshot enters the time and room estimate, or the update explicitly runs with no snapshot (`withoutSnapshot`, `platform/store/open.ts:270-277`).

Preparing a heavy change beside live data (a second table with triggers, a second file) is never built: a second writer fights for the single one, the schema is created by someone past the ledger, and for the preparation time two shapes of one data stand side by side.

## What the implementer proves

- A migration updating an entity table with a trigger and child tables passes with a dangling reference in an unrelated table and refuses on one it created itself.
- The law check refuses a migration with `UPDATE`, `CREATE INDEX`, rename or a history-table read, naming the operator, and lets `ADD COLUMN` through.
- A store with an unparsed operator in a pending migration gets a typed open refusal.
- A store with a long history opens with a pending entity-table migration in the same time as a store with a short one — on the [[212d752c]] rig.

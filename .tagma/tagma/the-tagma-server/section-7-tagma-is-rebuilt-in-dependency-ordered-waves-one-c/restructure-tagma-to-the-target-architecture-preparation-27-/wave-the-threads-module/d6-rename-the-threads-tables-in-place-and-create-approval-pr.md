---
id: 01a0ea30-4c20-7015-9555-00fa464e7bbe
title: "D6: rename the threads tables in place and create approval_preference, with no history-sized rewrite at upgrade"
ord: 7
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0e470-ffc4-7261-8631-2ffbf7e0b9dd
  - kind: waits-on
    to: 01a0e532-cc6c-73df-a111-c28429ce4645
---
The D6 migration of the threads card in [[f7e0b9dd]] has no builder.
- These tables are still unrenamed: `thread_target_operation`, `thread_owner_rule*`, `thread_seen` and `thread_live_spell`.
- The `approval_preference` table does not exist yet.
- `thread_owner_settings` has already lost its account columns.

Threads M2 [[29ce4645]] moves the stores under their current table names and renames only the TypeScript names; this task renames the tables.

Rules (coordinator ruling, the same as executions M3's):
- **Pure renames** use SQLite's in-place `ALTER TABLE … RENAME TO` and `RENAME COLUMN`. They rewrite the schema, not the rows, so their cost follows the schema, never the history.
- **Changes that cannot be made in place** keep the physical table and change only the Drizzle name, until the pre-release migration squash [[57330581]].
- **The new `approval_preference` table** is created empty. Any backfill runs as a bounded, resumable pass after admission, never at upgrade.
- **Before it runs:** the D0 snapshot of [[b5977128]] covers the touched tables, and the SQL gets two reviews, one Muse data/migration lens and one Muse performance lens.

Done when:
- the tables carry their card names, or a recorded deferral to the squash;
- `approval_preference` stands;
- both Drizzle chains check;
- the migration's cost is measured as schema-only on a sample store.

The migration's integration test runs at merge. Found by wave-platform during the threads M1 preparation.

---
id: 01a1512a-5405-76aa-a1f8-6933b179f647
title: Give a full index to the 11 history-table foreign keys standing without one
ord: 30
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1512a-6b5b-7729-a679-cac1d86aa87a",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a15120-d7b5-7ccf-a27e-5e7c97277b07
  - kind: relates
    to: 01a1283a-5861-76bb-aef5-965cd81b1676
sources:
  - kind: dir
    ref: apps/tagma/server/drizzle/20261018224500_history_foreign_keys
---
Rule [[d81b1676]] requires a history-table foreign key to have a full index with the key columns first; the initial `check_law` on HEAD found 11 keys without one (rule-escaped, by the schema in the latest migration): `command(environment_use_id)`, `command_window(project_id)`, `event(session_id)`, `landing_intent(project_id)`, `remeasure_landing(project_id)`, `target_snapshot(run_id)`, `terminal_intent(environment_use_id)`, `thread_cache_observation(thread_id)`, `touch(session_id)`, `workspace_change(project_id)`, `worktree_operation(root_id)`. Without an index, deleting or checking a parent scans the whole history. Indexing over history is heavy work: the new migration carries `heavy.json` with the reason and an estimate, by the rule. Result: migration `20261018224500_history_foreign_keys` adds 11 full indexes; the Drizzle declarations and the snapshot agree. Commit `18a8879246a34ec75a1a4d049c4d3c30debc50` passed the gate; `check_law` on it gives 0 violations, the repeat measurement kept the former enforcement and lifted all 11 escapes. 39 migration tests and a separate SQLite probe of the full chain passed, 16 index plans and 11 rows preserved; the probe with FK off did not check cascade. The independent [[01a1512e-97fd-72fa-bc3d-4115015a9afd|reviewer]] found nothing. The shared `bun run typecheck` did not pass — it failed on unfinished paging edits (`cursorSelection` not exported, `selection.ts` errors); the eight changed schema files have no diagnostics. The working base was not migrated, the server not restarted; duration on large bases was not measured.

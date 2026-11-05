---
id: 01a1ad3a-f940-7727-920c-1581a3d3b323
title: A new migration that renames or rewrites what the build before reads carries a back.sql that returns it, and one that drops a table or column keeps it in aside.json
ord: 8
tags: ["rule"]
fields:
  {
    "enforcement": {
      "debt": [],
      "escaped": [],
      "inspection": "migration-backs",
      "on": [
        {
          "op": "submit_work",
          "phase": "before"
        },
        {
          "op": "merge_worktree",
          "phase": "before"
        }
      ],
      "strictness": "gate"
    }
  }
sources:
  - kind: dir
    ref: apps/tagma/server/drizzle
  - kind: dir
    ref: packages/activity/drizzle
  - kind: dir
    ref: packages/execution-host/drizzle
  - kind: dir
    ref: packages/performance/drizzle
---
`back.sql` stands beside the migration's `migration.sql` and holds the statements that bring renamed or rewritten data back to the shape the build before reads; a step back runs it before reshaping the store onto that build's chain. Added tables, columns and indexes need none, nor a table rebuilt through a copy renamed into its place that keeps every column.

A table the migration drops, or a table it leaves without a column — by `DROP COLUMN` or by a rebuild that leaves the column out — is named in `aside.json` beside it: under `tables` its rows are kept and come back with a step back; under `derived` only when the build before rebuilds those rows itself. No comment excuses dropping user data.
---
id: 01a12999-45a0-733d-a49a-5ebea5ecf3a0
title: submit_work `paths` drops generator output attributed to nobody, though read_changes says `paths` lands it
ord: 10
tags: ["reflection"]
fields:
  {
    "actual": "The commit landed without it (\"not in this commit — `paths` named no file this session holds\"), leaving HEAD with a schema table and no migration; a second submit_work with `whole: true` was needed to land the two files as a separate commit.",
    "command": "submit_work paths=[…own files…, packages/execution-host/drizzle/20261011060806_execution_departure] after `bunx drizzle-kit generate` (run by this session while other sessions' commands ran)",
    "expected": "The migration directory written by this session's own generator command lands in the same commit, as read_changes promised: \"Moved by a command of this session but never written to the change record, so attributed to nobody — submit_work `paths` still lands them\"."
  }
---
Filed from project `runlith`.

Commits: dad9d48f8f (code without the migration), 106ba10d85 (migration via whole: true). The generator command's writes were marked "attributed to nobody" because peers' commands ran at the same time. Cost: one extra commit and an intermediate HEAD whose schema has no migration.
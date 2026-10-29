---
id: 01a128d2-01b7-7b48-9c20-d368c798d60b
title: An unproven adopted session ends without stopping the CLI and returns to the same thread via a regular hook
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261011042000_adopted_job_witness/migration.sql
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/adoption/shellJob.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/adoption.ts
---
Migration ends a stored adopted session with no birth with reason identity-unproven and releases its lease; the terminal and CLI stay alive, and sessionKey keeps the link to the thread. The current cache answer requires a job witness, so a regular hook after this transition calls adopt again: the birth owner finds the previous thread by project/harness/key and opens a new session. Job observation proves pid exit or replacement against the stored witness before reading foreground, whose refusal does not extend the life of a departed job. If foreground already carries another birth of the stored pid, the job is done, even when an earlier process report still shows the previous witness.

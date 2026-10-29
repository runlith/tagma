---
id: 01a12750-bb8d-78ce-9737-dfdb2b40d171
title: While a thread carries the offload mark, its journal is the rollout file and SQL rows are residue
ord: 5
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/log.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/replay.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rest.ts
---
The offload mark (`thread_rollout_cursor.rested_at`) is set by the offload's first transaction and cleared by the return's last transaction. Between them the thread's SQL rows are deleted and written in batches: the database writer is never held longer than a batch. So under the mark SQL may hold any residue.

- While the mark stands, the journal (`SqliteThreadJournal`, conversation-index catch-up) reads only the file. SQL rows under the mark are not read as this thread's journal. The exception is by owner, not by reading: when a branch points at the thread (`thread_base`), the offload leaves events up to its `through` and all transcript rows — the branch reads them, and the return neither duplicates them nor rebuilds the transcript.
- The return starts by appending to the file's end the SQL rows whose `id` is missing from the file: with new positions, after the file's last position. Only then does it clear SQL. So a row written past the file is never lost. Currently only the `20261009021800_terminal_runs` migration did this.
- An interrupted return or offload needs no separate pass: the next access restarts the return.
- An offload run by the background (archiving, reading, idling) pauses between batches. A human-actuated return runs with no pauses.

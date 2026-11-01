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
  - kind: file
    ref: apps/tagma/server/src/threads/journal/sourceFiles.ts
---
The offload mark (`thread_rollout_cursor.rested_at`) is set by the offload's first transaction and cleared by the return's last transaction. Between them the thread's SQL rows are deleted and written in batches: the database writer is never held longer than a batch. So under the mark SQL may hold any residue.

- While the mark stands, the journal (`SqliteThreadJournal`, conversation-index catch-up) reads only the published copy of the file (`thread_published_source`, an immutable `<journal>.generations/<id>.jsonl`), never the canonical file: a change to the canonical file outside a producer reaches no reader. Each act that changes the journal under the mark — offload, export, form step, repair, adoption of a mark that has no copy — stages a new copy and records it in the same SQL unit as its own change; the old copy is deleted only after that commit and after its last reader. Without that, a reader could see bytes no SQL row names, or a commit could name bytes already deleted. SQL rows under the mark are not read as this thread's journal. The exception is by owner, not by reading: when a branch points at the thread (`thread_base`), the offload leaves events up to its `through` and all transcript rows — the branch reads them, and the return neither duplicates them nor rebuilds the transcript.
- The return starts by appending to the file's end the SQL rows whose `id` is missing from the file: with new positions, after the file's last position. Only then does it clear SQL. So a row written past the file is never lost. Currently only the `20261009021800_terminal_runs` migration did this.
- The return refuses a file whose leading bytes no longer hash to the published copy, or that ends before the position the rows had consumed: a return would otherwise accept a changed or truncated history as the thread's.
- An interrupted return or offload needs no separate pass: the next access restarts the return.
- An offload run by the background (archiving, reading, idling) pauses between batches. A human-actuated return runs with no pauses.

---
id: 01a1031e-d5ce-7656-be01-1b1bce263514
title: Build the native-thread conversation index and the `search_threads` operation
ord: 1
tags: ["task"]
fields:
  {
    "holder": "tagma:01a1031f-50dc-7ab4-83d5-63971e875aa6",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a0ff2b-54ff-7f7f-91d2-8f52cc7f387c
  - kind: waits-on
    to: 01a1031e-d5ce-7656-be01-1b1ac473dc07
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/log.ts
---
Builds [[cc7f387c]] whole: the table and time-keyed contentless FTS5, the extractor on all journal paths, backfill at server startup, `search_threads` with a bounded page and held reads, `read_thread_record` with `conversation: true`, the doctrine section, the `read-beyond-project` consent.

Start with `apps/tagma/server/src/threads/journal/log.ts`, `projection.ts`, `replay.ts`, and the `apps/tagma/server/drizzle` migrations.

Done when the spec's acceptance is met, including the full operation's time measured on this machine's journal and reported as one sample.

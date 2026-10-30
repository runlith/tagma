---
id: 01a18c05-00ad-7aac-9961-6aa6a57d547f
title: Journal casts run in the reader's worker, one background cast at a time
ord: 138
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18bea-b9f0-7ddc-8922-0f75c9b1f9f8",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutEntryForms.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutWhole.ts
---
Bringing a lagging rollout to the current form parses, steps, rewrites and hashes every line of the file on the server's event loop (`stagedRollout` → `formInto`), and every read of an offloaded lagging thread forks its own background cast with no bound. Measured 2026-10-30 09:22–09:25 CET on the operator's server: ~70 loop stalls of 100 ms–1.15 s whose profiles sit in `formInto`, about a thousand transactions (mostly `ThreadRollout.form`) queued up to 96 s for the writer, and foreground reads such as `read_compaction_choices` taking 4.6–7.4 s.

Do: the file pass of a cast runs in the reader's worker, never on the loop; background casts drain through one queue, one thread at a time, so they never flood the writer ahead of foreground work.
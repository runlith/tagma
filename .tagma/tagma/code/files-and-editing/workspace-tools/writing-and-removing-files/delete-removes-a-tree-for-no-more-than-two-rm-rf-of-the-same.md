---
id: 01a17d2b-48ac-715a-8c97-6723a90d31cc
title: delete removes a tree for no more than two rm -rf of the same tree
ord: 3
tags: ["task"]
fields:
  {
    "holder": "tagma:01a17d15-2365-7960-a4b7-1e6edc96c783",
    "status": "in_work"
  }
edges:
  - kind: relates
    to: 01a17d16-446c-7040-8388-4947e5fe088c
sources:
  - kind: dir
    ref: packages/agent-tools/src/removal
  - kind: file
    ref: packages/agent-tools/src/delete.ts
---
The operator requires: `delete` on any tree costs no more than two `rm -rf` of the same tree, target 1.1–1.5×. Measurement of 27.10 (APFS, one machine, one sample): 22,001 entries outside checkouts — `rm` 1.99 s, `delete` 16.48 s; a call on 153,125 entries — 141 s.

The cost is work on every tree entry: finding the place in the change record (`placeAcross`) for each entry, three reads of the entry version via `readlink` + `stat`, a parent check and `realpath` of the lock key for each child, about ten spans. Inside a checkout, ignored files (`node_modules`, build) are written to the change record with each file's text, though their removal never lands in a commit.

What changes:
- the recording decision is one per root: Intake answers which paths under the root are recorded; outside checkouts, ignored paths without lines, git metadata and the graph store are not recorded;
- the entry type comes from the directory listing or one `lstat`; the version is checked once before removal; parent and lock key once per directory;
- the span is per tree with counters, not per entry (the operator's word under rule [[c33e5cbc]]);
- recorded files land in batches, not in two transactions per file;
- sockets and other special entries outside a checkout are removed; the place's refusal reason is not lost.

Acceptance — measurements on identical trees: outside checkouts, an ignored tree in a checkout, a tracked tree in a checkout; each no more than 2× `rm -rf`.

Done in `55be8f961a`. Measurement of 27.10, one machine, one sample: SQLite in a separate process, 5 pairs of `rm`/`delete` on identical trees, machine load 28–37. Medians (spread):

- 20×100 (2,021 entries): outside checkouts 0.66× (0.27–1.23), ignored 0.56× (0.33–0.93), tracked 1.57× (1.11–3.41).
- 100×10 (1,101 entries): ignored 0.66× (0.61–1.09), tracked 3.31× (2.15–3.95).

Not done: the tracked tree on the 100×10 shape. The tracked cost is the removal's own journal recording: each file is read whole, its text lands in the database, bytes are re-read for CAS before `unlink`. A calm measurement of the same shape (load 6–7, before inserts via `json_each`) gave a median of 1.77×; under the current load this is unconfirmed. Only a nanosecond-ctime comparison removes the re-read, but on filesystems with coarse timestamps it is unsafe.

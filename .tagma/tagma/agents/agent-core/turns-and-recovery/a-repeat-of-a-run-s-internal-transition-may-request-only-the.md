---
id: 01a12726-3550-7c71-b731-982a582d8349
title: A repeat of a run's internal transition may request only the last applied seq
ord: 3
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/drizzle/20261010183425_run_transition_receipt/migration.sql
  - kind: file
    ref: apps/tagma/server/src/native-harness/runs/transitionStore.ts
  - kind: file
    ref: packages/agent/src/thread/storage/memory/ThreadRuns.ts
  - kind: file
    ref: packages/agent/src/thread/storage/memory/ThreadTransitions.ts
  - kind: file
    ref: packages/agent/src/thread/transition/sequence.ts
---
An internal `runTransition` picks its seq itself under the run semaphore. A confirmed commit or replay moves the seq; any other answer leaves it, and a failure resets the local position to the `applied_seq` read. A lane may lose the answer after commit and return `stalled: uncertain`, so the still-readable receipt is the running run's last applied transition. The next commit replaces it, the end deletes it; `applied_seq` stays a historical counter.

At a finished run, any transition by seq receives a typed `ended`: the closing loop writes the journal's last tail before settle, so after the end the run has nothing to write, and a receipt is written only at a running run.

A new server loses its local sequence and starts from `applied_seq + 1`. A surviving external-harness process repeats reports by `reportKey` and does not pass internal seqs; their storage contract stays separate.

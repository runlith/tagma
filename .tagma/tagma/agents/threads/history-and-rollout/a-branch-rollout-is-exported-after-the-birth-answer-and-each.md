---
id: 01a1472d-7b63-7530-8f55-f56e8fdaec3a
title: A branch rollout is exported after the birth answer, and each first entry into a thread's journal completes the missing rollout
ord: 9
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/harness/births.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/conversationBackfill.ts
  - kind: file
    ref: apps/tagma/server/src/threads/journal/rolloutExporting.ts
---
A branch reads the source prefix in `thread_base` layers, so birth writes under the writer only the row, layers, model history, cursors, and the cut event when needed. A branch rollout carries only its tail and is exported after commit.

- **Conversation index.** Birth sets `thread_conversation` at `through = seen = through` of the prefix: prefix lines are found by search in the source's index through layers, nobody indexes them twice. The branch's own events are indexed by live appends.
- **Rollout.** `EngineBirths.ready` checks in the answer that export is possible: no traces of a prior journal, cursor, or refusal. Failing that check drops the branch, as before. The export itself `ready` forks as the last step with `startImmediately`. So its entry into the thread's journal lane queues synchronously, before the answer, and every later entry waits behind it. The lane position (`position()`) is only a number, not a queue place; it cannot be relied on.
- **Recovery.** An export that fell or was cut by a restart leaves the thread with events in SQL but no file. The rollout writer never creates such a file: its birth path accepts only an empty journal. So every entry into the thread's lane, while no writer is open for it, first calls `ThreadRollouts.owed`. It exports the journal when there is no file, cursor, or refusal but there are events. There is no separate pass over such threads: the next touch of the thread settles the debt.
- **Outside the lane.** `journal.open` is also called by harness-thread transitions (`JournaledTransitions`) and merge-notice. So only native branches take background export, while a hosted branch — and a spawn child seated by a harness — is exported in the answer.

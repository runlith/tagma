---
id: 01a10c9e-1482-712c-89b5-297c65c8fe13
title: An Attention event is recognized by eventId, which rename, archive and restore do not change
ord: 4
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/contract/service/attention.ts
  - kind: file
    ref: apps/tagma/server/src/threads/events/standing.ts
---
A run question's `eventId` is `<runId>:<question id>`: for native the id is the record's `questionId`, for an external harness — `question.id` from the session. The run is in the id because ACP question ids are RPC numbers, and a new process restarts them. For an approval question (its `questionId` starts with `approval:`) `eventId` is `approval:<questionId>`, with no run: its id belongs to the thread and survives the run or process end. For an ending — `<runId>:failed` or `<runId>:finished`. `at` is the question or run-end time; the fallback is the run start, not the thread's `updatedAt`, which rename, pin and read move.

The consumer is push. It dedupes repeats by the (thread, `eventId`) pair, so a new `eventId` for the same event would notify again, and a shared `eventId` on two different questions with the same text would swallow the second.

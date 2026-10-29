---
id: 01a0f9a9-a2ee-78eb-97fc-4b06d5c131db
title: Deleting a thread finishes its whole subtree whatever its size, and only a run that will not settle refuses it, before anything is deleted
ord: 81
tags: ["spec"]
fields:
  {
    "status": "closed"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/ending.ts
  - kind: symbol
    ref: packages/agent/src/thread/run/ThreadAggregate.ts
    symbol: deleteRow
---
## Outcome

`delete_thread` finishes the subtree it was asked to delete, whatever its size, or refuses before deleting anything.

Measured 2026-10-01: thread 01a0a186 (533 descendants, 1,833 runs, 3,204 held resources) was cut at 30.04 s by the fixed 30 s patience in `threads/ending.ts`. Children are deleted in their own units, so a cut can leave the tree partly deleted. The cut's refusal `delete-timed-out` is not among `delete_thread`'s declared refusals, so `declares` turned it into a defect and the caller read "An error occurred.".

## Design

- The patience bounds only waiting for runs to settle; every run of the subtree settles before any row goes, so a run that will not settle refuses `still-settling` and leaves the tree whole.
- The cleanup — commands, calls, held resources, rows — is never cut midway, and its cost grows once with the subtree: no per-thread round trip that one request for the subtree can replace. Tagma serves trees of thousands of threads on slower machines than this one.
- A long delete does not hold the caller: it runs detached where the background road of [[3bfd8b95]] stands.
- Every code an operation can refuse with is declared; the timeout codes of `stop_thread` and `delete_thread` follow the patience change.

## Acceptance

- An integration test deletes a synthetic subtree of a few hundred threads completely in one call and reports the time.
- A run that will not settle refuses `still-settling` with every row of the tree still standing.
- No refusal code reaches `declares` undeclared from the thread endings.

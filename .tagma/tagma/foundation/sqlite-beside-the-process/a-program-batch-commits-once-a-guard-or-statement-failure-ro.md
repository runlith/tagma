---
id: 01a1908c-f22d-717d-8ded-b88aaaabef6e
title: A program batch commits once; a guard or statement failure rolls back only its own program, a COMMIT failure fails every member
ord: 20
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a19024-7ec1-7479-b7dc-1386eb690904
sources:
  - kind: file
    ref: packages/sqlite-process/src/programs.ts
  - kind: file
    ref: packages/sqlite-process/src/host.ts
  - kind: file
    ref: packages/sqlite-process/src/channel.ts
---
The writer child runs a `Programs` batch between one `BEGIN IMMEDIATE` and one `COMMIT`, so programs queued while the writer was busy share one commit, and the writer is held for engine time instead of a loop round trip per statement. Each program runs under its own SAVEPOINT: a guard whose counted rows or changes miss its expectation, or a statement SQLite refuses while the transaction stays open, rolls back to that savepoint and answers `Conflict` or `Refused` for that program alone, while the rest of the batch commits. A statement error that ends the transaction and a failed COMMIT answer every member with the failure, so no member is answered `Applied` unless the COMMIT returned. A batch runs at the strictest `synchronous` level any member asked for.

The batcher takes the writer lease only to send a batch and gives it back at once. The child runs its messages strictly in arrival order and a batch is one message, so nothing can interleave with it; the lease only keeps a batch from being sent into an interactive transaction's open BEGIN…COMMIT. A writer that takes the lease after a send therefore queues behind that batch in the child, and no writer waits for the loop to pick up a program's reply. At most two batches are in flight; programs arriving meanwhile wait and leave together, which is what keeps group commit. The `synchronous` level a batch sets is recorded when it is sent, since every later message runs after it, and a handover waits for every sent batch to be answered before it retires the child. A program's hold is its share of the batch's execution in the child; its wait runs from submission to the send plus the time the batch queued in the child. Members are answered in commit order. A submission cannot be interrupted once queued: a caller that gave up could otherwise believe a committed program failed.

A batch whose child is lost is failed and never resent: the child commits before it replies, so a failed answer may follow a committed batch, and only the program's owner can tell the two apart from its own durable identity.

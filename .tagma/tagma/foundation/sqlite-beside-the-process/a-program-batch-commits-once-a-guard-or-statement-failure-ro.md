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

The batcher keeps up to two batches in the child while it holds the writer lease: the next one is sent while the previous executes, so the child goes from one COMMIT to the next without waiting for the loop to pick up a reply. It gives the lease back as soon as another writer waits for it or nothing is left; without that check a steady stream of programs would keep every interactive unit and the handover drain out. A batch's hold runs from the previous batch's answer to its own and is split across members by their execution time, so a program's hold measures the writer's occupancy, not its reply's trip. Members are answered in commit order. A submission cannot be interrupted once queued: a caller that gave up could otherwise believe a committed program failed.

A batch whose child is lost is failed and never resent: the child commits before it replies, so a failed answer may follow a committed batch, and only the program's owner can tell the two apart from its own durable identity.

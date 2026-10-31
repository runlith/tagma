---
id: 01a19024-7ec1-7479-b7dc-1386eb690904
title: Write units become programs the SQLite writer child runs alone, starting with the ACP protocol row and the journal append
ord: 5
tags: ["task"]
fields:
  {
    "holder": "tagma:01a18c99-08a8-7d13-8c7e-283fb89b8bcd",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a18cde-5f93-73e8-aa31-64572afe6fec
sources:
  - kind: file
    ref: apps/tagma/server/src/platform/store/transaction.ts
  - kind: file
    ref: packages/sqlite-process/src/host.ts
---
Step 1 of [[2afe6fec]], section B: a write unit becomes a program the SQLite writer child runs alone, so writer hold becomes engine time instead of loop round trips.

Measured in the bench's 5× stress run (one machine, `fb19c856` + `5556c2e7`): the writer was the ceiling. Loop p99 stayed at 7 ms, writer wait p99 reached 2 s, throughput capped near 9 hosted calls/s and the backlog grew without bound. 9,008 units held the writer for 88.7 s, of which only 9.3 s was acknowledged child time; 89.6% was outside the child. Two operations held 95% of it:

| Operation | Units | Hold sum | Child | Outside |
|---|---:|---:|---:|---:|
| `HarnessSessionStore.change` (ACP protocol row) | 4,223 | 60.4 s | 6.4 s | 54.0 s |
| `ThreadStore.kernel` (journal append) | 3,355 | 23.9 s | 2.1 s | 21.8 s |

What stands when done:
- the program mechanism of spec B: statements with guards sent as one message, executed between BEGIN and COMMIT in the child; group commit with a savepoint per program and the batch failure contract; an owner-stable operation identity with durable evidence that recognizes an unacknowledged but committed program on recovery; after-commit effects in commit order;
- `HarnessSessionStore.change` and `ThreadStore.kernel` run as programs, every check-then-act dependency of theirs carried as a guard;
- boundaries before host effects and acknowledgements unchanged ([[e47bd3fc]], [[ae10d61d]]).

Done when the bench's 5× stress run shows those two operations' hold close to their child time and the writer no longer caps throughput there, and the correctness tests spec B's Proof names for programs pass: kill -9 between commit and reply, COMMIT failure across a batch, a guard conflict aborting only its program, and a dependency changing while its target does not.

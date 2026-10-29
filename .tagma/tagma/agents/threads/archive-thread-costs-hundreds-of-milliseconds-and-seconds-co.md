---
id: 01a131f4-6516-7338-bbc6-44dc18285ad5
title: "archive_thread costs hundreds of milliseconds and seconds: commandsOwnedBy in the writing unit and ~140 sequential requests"
ord: 50
tags: ["task"]
fields:
  {
    "holder": "tagma:01a131f4-910d-701b-be58-3eaae8ab0c6a",
    "status": "done"
  }
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/stops.ts
  - kind: file
    ref: apps/tagma/server/src/threads/operations/acts.ts
  - kind: symbol
    ref: apps/tagma/server/src/executions/store/commandRows.ts
    symbol: CommandRows.commandsOwnedBy
---
`archive_thread` answers in 0.4–0.9 s under machine load, once 4–8 s (measured 12.10, ~21:00, machine 92% busy of 12 cores, server event loop healthy — p99 16–20 ms, no stalls). Goal — archiving cost grows with what is archived, not with table size and not with the number of sequential requests.

## What was measured

Span `archive_thread` 7ca5090fc2a9845c (909 ms, trace 67d49d44fa034d7cebc0ae383398ce92):
- `Terminals.stopCommands` — 488 ms. Almost all of it — one `CommandRows.commandsOwnedBy` inside the writing unit `stops.swept` (`executions/terminals/stops.ts`): `sql.execute` 457 ms, `db.queue.ms` 0, `db.exec.ms` 456 — engine time itself. The same `commandsOwnedBy` in a read unit after stopping — 7 ms.
- 141 more direct children, mostly sequential `sql.execute` at 8–37 ms each.

Span de4ba66f709c1c7c (380 ms) — same pattern: `stopCommands` 214 ms.

## What to do

1. Establish why `commandsOwnedBy` in the writing unit is ~60x more expensive than in the reading one: query plan (`command` ⋈ `command_wait` by `project_id`, owners, `created_run`), indexes, contention on the writing connection. Fix at the owner — query, index or read site, not a retry or cache at the caller.
2. Take apart the 141 requests under `archive_thread`: which repeat what is already known, which can be folded into one per subtree.
3. Prove the result by measuring the same scenario before/after (the `archive_thread` span and its breakdown) and with a contract test if behaviour changes.

Start at `threads/operations/acts.ts` (`archive_thread` → `ThreadTurns.archive`) and `executions/terminals/stops.ts`. Implemented: history-first JOIN replaced with command_wait-first; metadata record/mandate/opener merged, repeated projectOf removed, reads inside the journal lane marked MachineUnits.markReadOnly. Stand: 26 threads, 300000 finished commands, empty wait, 3 archive/restore; 2847/2071/2100 → 50.5/24.0/21.7 ms, SQL 151 → 99. Checks: typecheck clean, 20 archive/closure and 3 sweep contracts pass; one P1 of independent review fixed. The work landed in 120af534df and 0cf0b3150d9c334a4a2e7535bfac61e424a2ac1d (lane.ts and lifetime.ts); no held rows. After the operator's server restart the exact appendMeta allowance was updated via enforce_rule with site 26923b9a → d4b36720 under the same why, gate and triggers; the whole-reach inspection finished in 9.4 s, revision 6a8be81fd7b5. The original 456/7 ms factor, the deployed tail at 92% CPU and a non-empty wait are unproved on the stand.

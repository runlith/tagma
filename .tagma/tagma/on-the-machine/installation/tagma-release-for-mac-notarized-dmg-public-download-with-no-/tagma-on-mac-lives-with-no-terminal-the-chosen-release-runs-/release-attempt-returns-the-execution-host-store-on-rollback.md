---
id: 01a13ca9-dcd2-7d9c-9ba8-d7d2e0867f81
title: "Release attempt returns the execution-host store on rollback: host logic switch after the door or a snapshot of the host store inside the logic itself"
ord: 6
tags: ["task"]
fields:
  {
    "holder": "tagma:01a13c9d-2ae0-7b6d-97ab-853784c4ca99",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a13c9b-6e47-7eb9-82e5-4f3e5e37dc34
  - kind: implements
    to: 01a13c7f-b7b8-77fb-b506-75271c89545b
  - kind: relates
    to: 01a1271e-2479-7971-9b0c-4ec5d86d6647
---
Rule 1 of [[1c89545b]] requires an attempt to write before its door only what rollback returns. Execution host breaks it: the successor takes the host logic with the new digest before the door (stage 3 of [[9b246531]], `placedHost` in `createRuntime`), the new logic migrates the host store (host-store has its own migrations), and after rollback the earlier release puts up its bundle whose logic refuses the base with the longer ledger (`continuation` → `Diverges`). A server-side snapshot of the host store is not cheap to take: it is another process's store, and executions write into it between handover and rollback.

Resolve in the executions module one of two ways: the host logic switch goes after the `to` door (the `to` server talks to the old logic before the door — host wire is versioned), or the host logic itself snapshots and returns its store on attempt rollback. Until this task is done, rollback after a release with a new host-store migration does not return executions — a release with such a migration does not go to people before it.

Done: on its own instance an attempt with a new host-store migration and a failing machine-store migration rolls back, the earlier release comes up, its host answers, and an execution started before the attempt is alive.

Done in fcb05550ef and ba4345cbfd: the host logic switch goes after the door, and only in a live attempt. While the door is not open, `to` takes its bundle's digest only by reading (`carriedOffer`). It lays no candidate, wakes no host and runs no terminals. After the door it lays the candidate, asks the foreign host to yield and takes custody of the bundle standing after the switch. A failure of this path leaves the cause in `standing` and writes it to the log. A copy of the host store was rejected: it would lose or double execution output.

Checks:
- `hostChange.stest.ts` run on HEAD slice passed: 5 of 5 in 26.8 s. The new case raises a release in an attempt whose door never opens. Host and execution output stay untouched. Then rollback to the earlier build: counter continuous. Then the same attempt with the door opened: same holder, new logic, custody, counter continuous.
- Live rollback from 0.1.1 ([[5e37dc34]]): in all four outcomes the 0.1.1 holder and host-logic pids never changed. Counter output reads continuously.

- Host-store migration proven in 6809d9737a. The attempt case in `hostChange.stest.ts` now raises a `to` whose host logic carries an extra host-store migration. While the door is not open, and after rollback to the earlier build, the `executions.sqlite` ledger never changes, the earlier logic rules the host, the counter stays alive and continuous. After the door the logic switches, the migration lands, the counter stays continuous. Run on HEAD slice 24b29f2dfa: 5 of 5 in 28 s.

Not proven:
- Handover of the host after the door in a live attempt of a built release never ran live, only in stest.
- While the door is not open, terminal services answer `WireUnavailable`. Whether an early caller is hurt by it is unchecked.

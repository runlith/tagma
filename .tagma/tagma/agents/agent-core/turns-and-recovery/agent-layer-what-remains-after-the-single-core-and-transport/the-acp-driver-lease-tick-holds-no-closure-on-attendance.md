---
id: 01a151df-e920-73d7-9b09-09e2aadcaadd
title: The ACP driver lease tick holds no closure on Attendance
ord: 17
tags: ["task"]
fields:
  {
    "holder": "tagma:01a151fb-a858-74a6-80bc-abc30183c034",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a151df-e920-73d7-9b09-09d091976ebe
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/beat.ts
---
Driver ACP lease ticks never close over Attendance. ACP driver parts assemble by owner with no closures to neighbors except two: `protocol/driver.ts:253` passes `ProtocolBeat` a `attendance.forfeit` callback, and the lease tick (`protocol/beat.ts`) calls it upward for every lease it did not renew; `ProtocolSteps` receives `tailing`, which through `Effect.suspend` calls `runs.tailed` — a part assembled later — while `tailed` itself works only with leases, journal, and `steps.persist`. Dependencies hide from the part order. `compacts` at `ProtocolPrompts` is a port the driver creator passes, not a neighbor function.

Done (b47a47a8c6): `ProtocolBeat.tick` answers the leases whose rent it did not renew; the tick belongs to `ProtocolAttendance` (`hold`), and it takes its own fibers down. The tail timer moved into `ProtocolSteps` with `tailed`; `ProtocolRuns.tailed` is deleted. Checked: server typecheck, `protocolRaces.stest.ts` 9/9. Unproven: `protocolHandover.stest.ts` — a live Claude Code test; the run hit the account weekly limit (`claude -p` answers "You've hit your weekly limit"), the turn hung to the 58 s timeout.

To do: the tick outcome — lost leases — is read by Attendance or published by the lease owner; `ProtocolBeat` receives no neighbor function.

---
id: 01a17b9c-dad9-725d-8649-25a1b96c9479
title: "Starting a command under the admittedCommand mask waits for the host handover to the server with no deadline: readiness waiting must stand before reservation and stay interruptible"
ord: 45
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16e20-3dd6-7696-901e-d29696ccb336",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a113c8-ea78-7cac-906f-6e35921f3a5a
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/custody.ts
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/start.ts
---
`admittedCommand` holds `terminals.start` under `uninterruptibleMask` so an interrupt after the child starts never leaves it alive (690498b). Inside `terminals.start`, before any request goes out, stand waits with no upper bound: `custody.starting` waits for `ready` — the handover of the host to this server from the previous one (`Deferred.await(takenOver)`, `executions/assembly.ts:322`) — and `ensure()`. Until they finish, nothing goes to the host, yet interrupting the turn (stopping the agent during a commit step or inspection) waits them out to the end.

Making `ready` interruptible in place is not possible: it stands after root reservation and moving the intent to `dispatched` (`terminals/start.ts:139,285`), and `recoverStart` only resolves such intents at load (`startsBefore(openedAt)`), so the reservation would hang until restart.

Needed: host-readiness waiting before reservation (the host port hands it out separately, `Terminals.start` awaits it interruptibly ahead of `reserve`), or `dispatch` drops the reservation on an interrupt that arrived before sending. The race from 690498b must stay closed (`programRoad.itest.ts` asserts `alive === false` right after interrupt), and `hostChange.itest.ts` must still wait for the door for an early start.

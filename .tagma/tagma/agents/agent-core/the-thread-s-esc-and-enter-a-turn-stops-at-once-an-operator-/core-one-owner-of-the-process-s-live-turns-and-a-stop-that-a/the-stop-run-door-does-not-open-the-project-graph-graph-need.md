---
id: 01a15f7c-f8e6-72eb-835d-18b109bab315
title: "The stop_run door does not open the project graph: graph need is part of the operation's declaration"
ord: 2
tags: ["task"]
fields:
  {
    "holder": "tagma:01a15f72-9a6f-7029-ae83-9e04a1803a1c",
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a15eeb-6b48-7ca8-9c93-24d47031f1f3
---
Shared call admission opens the project graph before the operation is known (`invocation/admission/project.ts`, `pool.resolve`), so `stop_run` on a cold project waits for the mirror build. The operation declares that it does not read the graph; each door's admission (socket, HTTP — MCP and `tagma op`) opens no graph on that declaration, and a false declaration refuses loudly instead of sliding into the machine graph. Verify that the stop intent awaits no journal lane of the thread. Proof is a contract test and the `stop_run` answer time on a cold project before and after.

Done in `faeb19bf68` and `fd3f625ae5`; the contract is [[ea4147d8]]. Measured (one run, the operator's machine under load from other agents, a `makeDoorWorld` test world, a stealth project of 40 blocks, an idle thread, `SocketOperations.perform`, five probes): cold project — 421/480/447/447/558 ms before, 7/7/17/7/5 ms after; warm — 4/3/4/4/7 ms before, 5/6/17/6/5 ms after. The stop entry (`EngineHandles.stop`, `ThreadAggregate.stop`) now reads the thread metadata line instead of the full history; that part was not measured.

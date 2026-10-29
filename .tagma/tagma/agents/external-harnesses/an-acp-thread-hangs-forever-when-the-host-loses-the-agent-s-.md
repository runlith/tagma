---
id: 01a1662f-6bcc-73be-ba35-6bb663aea3c0
title: "An ACP thread hangs forever when the host loses the agent's stdout: Esc never goes through, the run never ends"
ord: 114
tags: ["task"]
fields:
  {
    "holder": "tagma:01a16620-741d-708e-a6ae-318f61160f11",
    "status": "done"
  }
edges:
  - kind: relates
    to: 01a0fd8b-bf17-7729-bc6f-2284f37a2606
  - kind: relates
    to: 01a16624-d717-7dee-8615-3f88715d8dc8
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/protocol/process.ts
  - kind: file
    ref: packages/execution-host/src/subscriptions.ts
---
The `boot-memory` thread (claude-code/opus high on ACP) stopped moving for good on 22.10 at 23:56Z: the journal stood on an unfinished `write`, the parent's Esc and interrupt hung for 5 minutes, server restarts did not help, the reaper refused with “run is live”.

The chain, established from records:

1. 23:56:24.6–27.8Z the execution host main loop blocked for 3.2 s on synchronous native `processFacts` (stall `b7d42d5d`, profile `ed54de63`: 2618 samples in `processFacts`, then the timer `orElse` and `RecordWriteFailed`). The machine was under two release builds.
2. Runner stdout segment write is bounded by 2 s (`bounded` in `RecordWriter`, `ACT_MS = SHUTDOWN_PHASE_MS`); after unblocking the timer fired before the write answered, execution `d759085b`'s stdout stream closed with `ending: error` at 1,216,651 bytes. The host stopped reading the pipe, the runner process stayed alive.
3. The host byte subscription ended for the driver as `completed` (`awaitMore` → false → `end('completed')`), though the stream ended in error.
4. The ACP driver deemed output finished, stopped the frame writer and waited on `executionEndings.decided` — the exit of a process nobody would reap. `session/cancel` (Esc) and agent answers never passed again; `call_hosted_tool` calls waited for a message write that will never come, getting 503 only when the server stopped.

Fix at the owners: a subscription on an error-ended stream ends `unavailable`; the ACP driver whose agent output ended with the process alive stops the process and ends the session with a cause instead of waiting for its exit; the host's native process reads never hold its main loop (child task).

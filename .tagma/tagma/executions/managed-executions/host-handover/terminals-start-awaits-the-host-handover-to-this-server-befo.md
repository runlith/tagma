---
id: 01a17bb3-1db0-78bb-9ca8-684893f8cf60
title: Terminals.start awaits the host handover to this server before taking anything, and interruptibly even under the caller's mask
ord: 8
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a113c8-ea78-7cac-906f-6e35921f3a5a
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/terminals/start.ts
---
The wait stands first after the operation-key check: before it the start took nothing — no environment, no root, no request key — and nothing went to the host, so interrupting here is safe for any caller. Waiting later is not possible: only load resolves the root reservation and the `dispatched` intent (`recoverStart`), so a wait after them would either hold the stop until the host handover or leave the reservation hanging until restart.

`Effect.interruptible` lifts the caller's mask here deliberately: `admittedCommand` holds the start under `uninterruptibleMask` so as not to abandon an already accepted process, and that mask guards only the accept window. Without this, an agent stop during a commit step or inspection on a server that hasn't taken the host from the predecessor yet would hang until the handover ends.

The readiness custody hands the start is the host handover and then `ensure()`: its adoption, `status` and take also await the host's answer with no deadline. The `custody.guarded()` port itself still awaits the handover and calls `ensure()` before every start and cancel; for a start through `Terminals.start` the handover already happened by then, and the held custody answers from memory. The wire's own waits in `executions.start` — reconnect and Welcome — stay after the reservation and under the caller's mask.

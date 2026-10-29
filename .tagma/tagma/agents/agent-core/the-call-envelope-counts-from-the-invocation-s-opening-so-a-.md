---
id: 01a0d4e7-2c46-77ad-a2fa-8ebb5a65cc1c
title: The call envelope counts from the invocation's opening, so a permission ask or a queue wait eats into the longest act a foreground command was admitted for
ord: 117
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0d4f3-17e3-7a7c-83d2-9cc74598c6a5",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0d4d9-1769-777b-bcda-913997ac5624
sources:
  - kind: file
    ref: packages/agent/src/agent/AgentToolDoor.ts
  - kind: symbol
    ref: packages/agent/src/agent/AgentCalls.ts
    symbol: AgentCall
---
**Why.** `AgentCall.opened` is taken when the invocation opens, before preparation, the permission question and the wait behind an earlier write; `armEnvelope` is armed at admission but measures `envelopeMs - (now - opened)`, and `expiresAt` is `startedAt + envelopeMs`. The comment over `armEnvelope` says the envelope stands from admission. A foreground `bash` with `timeout: 600000` approved 12 minutes after it was asked gets about 8 minutes; approved after 20, it is stopped at admission. `limit` ([[5a461f9e]]) measures from the same instant, so [[5337b23b]] stays consistent with the envelope, but the command's own deadline counts from the host's start.

**Decided by the operator, 2026-09-24.** The envelope's clock starts at admission, and `limit` counts from the same instant. Until the reader answers, or while the call waits in the queue, nothing runs, so none of that time belongs to the command. A question still waits for its answer as long as it takes; only a tool that declares its own reader deadline lapses one.

**Done when** the decision is recorded and, if the clock moves, a foreground command admitted for the longest act after a long ask runs it whole; tests cover the ask.
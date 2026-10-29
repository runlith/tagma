---
id: 01a12717-89d5-7ba4-bc9f-f63adfa55856
title: A wait-backgrounded command's outcome survives a server restart through a single delivery road
ord: 122
tags: ["task"]
fields:
  {
    "holder": "tagma:01a126d8-b45a-7625-80ec-5c219df15839",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a126d8-769a-7997-bfeb-d0f07b1a63ca
sources:
  - kind: file
    ref: apps/tagma/server/src/threads/collaboration/commandEndings.ts
  - kind: file
    ref: packages/agent-tools/src/bash/managed.ts
---
A command `bash` backgrounded on waiting (or the operator via `handOff`) delivers its outcome only through the in-memory call (`AgentCall` → `callEndings`). On server restart the call line closes as "interrupted, effect unknown", while the command itself lives in the host until the end of its life (up to 6 h), and nobody will deliver its end: the `CommandDelivery` obligation opens only for `waitMs: 0`.

What to do: on backgrounding (`ManagedCommands.background` already switches the mode to `background`) open a `CommandDelivery` obligation and answer the call with `completion: 'command'`, so the call delivery counts as `elsewhere`. One reliable road for both paths. Decide what is lost: the `CommandDelivery` notification carries no file and HEAD attribution that the `bash` answer gives; and how not to get two outcomes if `handOff` failed after the mode switch.

Proof: a test — a command backgrounded on waiting, the server (call owner) recreated, the command end reaches the thread as one notification.

Found by the `times-review-opus` review of delivery [[7b1a63ca]].

---
id: 01a130f0-b4d2-7196-ac3f-8d9e1d87004e
title: RPC pre-admission reorders input ahead of the lane queue
ord: 1
tags: ["reflection"]
fields:
  {
    "actual": "A controlled delay before the sequence-0 handler let sequence 1 through first: the real terminalChannel and ExecutionInput answered InputConflict, and the real TerminalInput showed the banner's exact text and opened a second lane. The host accepted one byte, acceptedThrough=1, pendingBytes=1. Without the delay both requests are accepted, delivered=ab.",
    "command": "bun -e 'const probe = await import(\"~/.tagma/scratch/01a130cf-f79d-7fcf-9df7-a34d31836cd5/input-order-probe.mjs\"); await probe.runClient(await import(\"effect\"));' (workdir: /opt/workspaces/runlith/apps/tagma/server)",
    "expected": "One lane's input keeps sequence order under varying RPC pre-admission durations; the client receives receipts with no false order conflict."
  }
---
Filed from project `runlith`.

In the incident build `19a69dbb2a` `composition/socketBinding.ts` runs async `admitFeed` before calling the handler; the `inTurn` queue in `executions/terminals/channel.ts` starts only inside the handler. So it preserves the order in which pre-admission completed, not the order input was sent. In the browser marks around 15:50:44 UTC the first lane lacks receipts 12 and 14, has receipt 13, then a new lane appears; this matches the reproduced race, but marks do not keep receipt 13's type, so the historical event's exact cause is unproven. The focus-reports hypothesis is unconfirmed: the current shell screen reports sendFocus=false. The probe ran in memory with an artificial admission delay; the working terminal and server were unchanged.

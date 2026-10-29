---
id: 01a116e1-3ce7-72ea-9ca3-7b33b1f87087
title: Hook reading keeps evidence of a lost event instead of silent undefined
ord: 1
tags: ["task"]
fields:
  {
    "status": "open"
  }
edges:
  - kind: discovered-from
    to: 01a116c6-1f18-74ee-a89f-967c69003cc1
sources:
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
    symbol: observe
  - kind: symbol
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
    symbol: parsedEvent
---
In `hooks/dispatch.ts` the functions `parsedEvent` (line 81) and `observe` (line 221) turn any stdin read failure into `undefined`/an empty return, after which the event never reaches adoption, report, or touch accounting. Preserve for Tagma the distinction between a missed event and an unread hook, without breaking the agreement that a hook never breaks another CLI's turn. Start from `HookEventFailed`, `hookText`, and the `parsedEvent` consumers; define a durable failure/evidence-of-loss channel instead of a new unbounded retry. This is separate work: hook observation protocol changes. Done when an owner-level test shows a read failure and a bad payload as an observed unread hook, and a good event delivered exactly once; the code is landed.

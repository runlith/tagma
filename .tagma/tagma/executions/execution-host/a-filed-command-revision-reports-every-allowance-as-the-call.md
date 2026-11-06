---
id: 01a1b2d4-184e-70c2-a0bf-42f138a445de
title: A filed command revision reports every allowance as the caller's, even a background handoff that kept its default origin
ord: 74
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/execution-host/src/registry/revisions.ts
---
`standingDeadline` answers a command's deadline from the queued allowance, else the live call, else the applied revision record; `filedDeadline` projects that record with `origin: 'caller'` and no `foregroundMs`, because `CommandRevisionRecord` stores neither. A background handoff revision keeps the admitted default origin and drops the foreground bound in the live allowance, so any read that falls to the filed record — between the queue and the live call, or after the call ended — reports the wrong origin and a foreground bound it does not show. Seen in Linux integration run 42298062057, where `CommandDeadline.itest.ts` read origin `caller` after a background handoff. Record what the applied revision left — origin and foreground bound — so the filed projection answers what the live one did.
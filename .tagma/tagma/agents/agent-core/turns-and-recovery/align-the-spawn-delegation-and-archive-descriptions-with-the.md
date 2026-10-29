---
id: 01a14b71-e6c2-7781-b0d4-36f83fbcd691
title: Align the spawn, delegation, and archive descriptions with the executable contract
ord: 6
tags: ["task"]
fields:
  {
    "status": "open"
  }
sources:
  - kind: file
    ref: packages/agent/src/collaboration/spawnLimits.ts
---
Fix the spawn, delegation, and archive descriptions against the executable contract. The decision from reading live hosts: remove wholly the unused tree-token ceilings and host-slot ceilings; the real spend accounting, delegation, and depth stay. The Tagma server sets no spawnSlots, and budgetTokens are written only by tests; the repository holds no other working host of those ceilings. fork_thread creates an independent root: Threads.create's parentThreadId addresses the request's owner, provision=null routes to insert rather than insertChild. The archive holds another thread's messages and tasks until a newly admitted run. Done in eb7e2a58fd: tree token ceilings removed; the host-slot ceiling `spawnSlots` stands (`CollaborationConfig.ts`, `CollaborationVoice.ts`, `ThreadPlanes.ts`), the description reconciliation is unconfirmed. Proof: reading full paths and the SQLite adapter, owner and migration checks, bun run tagma:typecheck, one independent Sol xhigh review, and the commit.

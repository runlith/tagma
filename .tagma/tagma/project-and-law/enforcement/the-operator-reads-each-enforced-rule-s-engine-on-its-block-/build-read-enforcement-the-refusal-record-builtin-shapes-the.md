---
id: 01a0f7ec-3b2c-70ab-a21f-1375c1e12165
title: Build read_enforcement, the refusal record, builtin shapes, the Law surface and the rule engine on the block page
ord: 1
tags: ["task"]
fields:
  {
    "status": "closed"
  }
edges:
  - kind: implements
    to: 01a0f7ec-23e0-7536-8498-9e02dae3af36
---
Build [[dae3af36]] in its order (§9).

Files: `apps/tagma/inspection/src/core` and each pack declaration (shapes, concerns); `apps/tagma/server/src/enforcement` (operation, page families, voice, refusal record, store table, migration under `apps/tagma/server/drizzle`); `apps/tagma/app/src/lib/features` (repo, Law surface, engine, block facts), `routes/[project]/law`, `workspace/address.ts`.

Done when §7 holds: contract tests for the operation and the record pass, server, inspection and app typecheck, the reviewed findings that hold are fixed, claims are written from the code, and a showcase of the live screens stands.
---
id: 01a0ca85-8b96-7af2-ad3c-63fbcf809b3d
title: Write the claims of the world and the factory
ord: 168
tags: ["task"]
fields:
  {
    "holder": "tagma:01a0ca86-8e4d-71d5-83ad-79c00edba7e8",
    "status": "done"
  }
edges:
  - kind: discovered-from
    to: 01a0ca85-8b21-7009-8bcc-eddc5565be05
  - kind: implements
    to: 01a0c6cf-2598-7080-b939-60f5a014cd4c
---
Write the claims of [[8d4ee330]] from the code, under parent [[8d4ee330]].

Read whole: `packages/agent-tools/src/World.ts`, `packages/agent-tools/src/workspace.ts`, `packages/agent-tools/src/index.ts`. Reference zones for precision (never size): [[d1caad35]] and [[13756ad0]].

Cover: what each world resource binds and what its absence removes; the host default; the fence (lexical and symlink); the writer locks and their keying; prepared paths and the bindings proof; how `createTools` composes the catalog and how the type level derives its membership.

Done when: every claim is written from the code and verified, every symbol anchor resolves, `run_doctor` over the area's paths stands clean, and a review of the zone passes.

---
id: 01a19409-a00d-7d3e-a0e8-5bbc91b82447
title: Client contract commit attributes compiler Format import to server entry
ord: 168
tags: ["reflection"]
fields:
  {
    "actual": "Refused lines-held for Format in packages/vigla/src/entries/index-server.ts:21 held by templates, although the client contract imports Format from vigla/compiler rather than the server runtime entry.",
    "command": "submit_work({project:44,subject:'feat(kit-client): define the generated browser app contract',paths:['packages/kit/src/types/internal/client.ts']})",
    "expected": "Commit the client app contract, whose Format import is type-only from vigla/compiler and whose public type dependencies are committed."
  }
---
Filed from project `vigla`. Received by a server up since 2026-10-31T17:51:49.846Z, from 3a395b0b3.

The first landing also named foundation's public types, which subsequently landed. The remaining refusal points to a same-named export in the wrong published entry. packages/vigla/package.json maps vigla/compiler to src/entries/compiler.ts; client.ts imports Format from that published specifier. The tool offers waiting for the unrelated server export or carrying that peer's whole file.
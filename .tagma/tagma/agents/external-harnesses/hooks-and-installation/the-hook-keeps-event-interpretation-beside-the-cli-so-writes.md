---
id: 01a18daf-8359-7922-b6ad-328216d261a6
title: The hook keeps event interpretation beside the CLI so writes retain their before-text witness while the server is absent
ord: 10
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/rows.ts
  - kind: file
    ref: apps/tagma/server/src/external-harnesses/hooks/dispatch.ts
---
A relay cannot capture a file before a write without interpreting the event; moving that work to the server would lose the witness whenever the server is unavailable. Named hooks load their harness declaration alone, using the registry's package index for installed adapters. Legacy unnamed commands take their answer codec from the server's receipt or the CLI's published session identity; with neither, they print no guessed envelope.
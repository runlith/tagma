---
id: 01a12877-c4e4-71a5-aac7-b90e70c79d88
title: The bundle manifest names the OS, architecture, and part paths, and the server refuses typed before starting the holder on a foreign OS
ord: 3
tags: ["task"]
fields:
  {
    "status": "done"
  }
edges:
  - kind: implements
    to: 01a127ad-cc0d-7a03-b77a-95f17df613b0
sources:
  - kind: file
    ref: apps/tagma/server/src/executions/host/boot.ts
  - kind: file
    ref: packages/executions/src/EndpointConnection.ts
  - kind: file
    ref: packages/executions/src/protocol/artifact.ts
---
Per the "OS without an adapter" section of spec [[7df613b0]]: the manifest names the build OS and architecture and the paths of parts by role; the server (`executions/host/boot.ts`, `raiseHost`) reconciles the OS before starting the holder and answers with a typed refusal carrying the OS; holder, library, and endpoint paths come from the manifest and registry, not constants (`BUNDLE_HOLDER`, `BUNDLE_LIBRARY`, `transport: 'unix'`); the holder binary does not build on an OS without a platform module (`holder/src/main.rs`). Done when the OS refusal test and narrow boot tests are green.

---
id: 01a129c0-3aef-7d72-a905-63aadd9dea8d
title: The boot refusal is shared with the machine reader without importing the host runtime
ord: 7
tags: ["explanation"]
edges:
  - kind: discovered-from
    to: 01a129ae-6dfd-774f-8185-abe3e3159608
sources:
  - kind: file
    ref: packages/execution-host/src/composition/macos.ts
  - kind: file
    ref: packages/execution-host/src/composition/platform.ts
  - kind: symbol
    ref: packages/execution-host/src/boot.ts
    symbol: BootRefused
  - kind: file
    ref: packages/execution-host/src/composition/posix.ts
---
BootRefused serves both opening the process reader in the server and starting the host logic. It lives below their compositions so the reader adapter never pulls the host runtime and xterm's browser declarations into the server's Bun project: a shared DOM namespace changes Worker, WebSocket and BodyInit across the whole server project.

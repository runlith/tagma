---
id: 01a1482d-919e-7358-a621-54aeaafa74f0
title: CDP channel routes a message by bounded head and tail text, and parses a payload over 1 MiB in a worker
ord: 1
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/cdp/src/payload.ts
  - kind: file
    ref: packages/cdp/src/wire.ts
---
The CDP channel routes a message by its bounded head and tail text, and a payload over 1 MiB is parsed by a worker.

`header` reads only the first and last hundred characters: Chrome writes `id`/`method` as the first field and `sessionId` last (measured on Chrome for Testing 151 over pipe). So a tens-of-megabytes screenshot or a node-children dump with thousands of descendants reaches the session owner without `JSON.parse` on the server event loop; `payload.ts` parses it — inline up to 1 MiB, beyond that in a worker. If Chrome changes the field order, `header` does not recognize the message: the answer never arrives, and the call waits for it without a deadline — system tests fail the engine on their own deadline. A host bringing CDP another way (Electron `webContents.debugger` hands an already parsed object) builds the `Transport` with its own text in the same order.

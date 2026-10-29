---
id: 01a18553-b743-76cd-bc37-678670b05439
title: Page heap bytes go straight from the renderer to its file
ord: 38
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a184dc-4fbe-7b01-a2d5-4faa4b4a0d78
sources:
  - kind: file
    ref: apps/tagma/desktop/src/browser/host.ts
---
Heap snapshot chunks over the debugger would pass through the same main process that handles window input. The host therefore calls Electron's native file-handle route while the debugger stays attached. The native producer owns a pause on its captured renderer process until the promise settles or that process exits: ending the server's waiter, losing its channel, or destroying the source page cannot stop V8 while other pages share the renderer. Process identity includes its creation time so a reused OS process ID ends the old capture. The shared heap scenario on the desktop host proves the file route for sandboxed renderers under Electron 44.8.
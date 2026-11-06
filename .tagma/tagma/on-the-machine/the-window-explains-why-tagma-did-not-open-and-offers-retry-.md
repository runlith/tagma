---
id: 01a14c05-71a7-71c8-88a1-ee546656e4ff
title: The window explains why Tagma did not open, and offers retry or a report
ord: 27
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee48e7ff5201
  - kind: relates
    to: 01a14c05-9e90-75d0-ab7c-580f84a0bdd4
sources:
  - kind: file
    ref: apps/tagma/desktop/src/server.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/desktop/src/waitingPage.ts
---
**Value.** A missing or broken server does not leave the person before an empty window: state and available action are visible.

**How.** The desktop's built-in waiting page; retry and report saving on it.

**Behaviour.** The window tells apart installation, launch, another active channel, someone else's answer at the address, a start failure and an unfinished data return. A live launch is not declared failed just because of duration; after an actual exit the saved reason is read. An already open surface keeps being watched and goes through launch again if the server disappears. A server that itself reported a stuck writer is taken down and raised again by the window, warning of interrupted agents.

**Limits.** Only the window's own local server can be automatically raised and restored. For an explicitly named address the window shows waiting and retry, without managing the process. During a normal launch the page does not unfold the detailed migration course; phase and reason are available on a recorded failed start.

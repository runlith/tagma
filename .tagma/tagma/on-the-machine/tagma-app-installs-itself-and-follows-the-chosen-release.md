---
id: 01a14c05-71a7-71c8-88a1-ee45adeff637
title: Tagma.app installs itself and follows the chosen release
ord: 12
tags: ["feature"]
fields:
  {
    "state": "live"
  }
edges:
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee460a9ce615
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee48e7ff5201
  - kind: relates
    to: 01a14c05-71a7-71c8-88a1-ee4aba458262
sources:
  - kind: file
    ref: apps/tagma/desktop/src/main.ts
  - kind: file
    ref: apps/tagma/desktop/src/placing.ts
  - kind: file
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
  - kind: file
    ref: apps/tagma/server/src/mac-applications/placement.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/install.ts
---
**Value.** On Mac, Tagma installs by opening the app: the person needs no terminal and no separately installed runtime.

**How.** Opening `Tagma.app` from a DMG, Finder or Dock; the internal `install-from` CLI.

**Behaviour.** The app checks the signature and release contents, keeps a self-contained copy apart from where the person holds the app, and raises the server. An older app follows the selected release, a new one offers its own; a window that already ran on the selected release also follows back. Where the app cannot be replaced, the saved copy opens. Opening outside Applications once offers to move the copy there; the source stays.

**Limits.** This is a macOS delivery; separate branches for other OSes in shared packages do not mean a ready installer. A broken signature, an unsuitable machine and missing room stop installation. Connecting to an explicitly named surface neither installs nor raises its server.

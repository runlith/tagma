---
id: 01a16efc-5d7f-75ee-98d1-faffa11304b6
title: A release lease is confirmed by a held lock
ord: 26
tags: ["explanation"]
sources:
  - kind: symbol
    ref: apps/tagma/desktop/src/main.ts
    symbol: settled
  - kind: symbol
    ref: apps/tagma/desktop/src/release.ts
    symbol: leaseRelease
  - kind: symbol
    ref: apps/tagma/desktop/src/SurfaceLoader.ts
    symbol: SurfaceLoader
---
A window of the installed release with an automatically chosen local address uses its release's files, so its directory holds a shared flock incompatible with cleaning. A running helper does not yet mean a held lock: opening the surface waits for the lease confirmation. A late confirmation after the window is gone opens neither the surface nor offers the move to Applications; a lease failure at opening becomes an explainable launch error. The helper holds the lock until EOF from the window; there is no `bun:ffi` in Electron, so the runtime of the release itself is the holder.

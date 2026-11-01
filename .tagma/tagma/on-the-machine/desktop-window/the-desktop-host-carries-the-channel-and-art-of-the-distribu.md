---
id: 01a19477-b637-7827-b347-791779d8c613
title: The desktop host carries the channel and art of the distribution that cut it, written into its bundle at build
ord: 42
tags: ["explanation"]
edges:
  - kind: relates
    to: 01a19371-d3c3-70d3-886f-04320ac072c1
sources:
  - kind: file
    ref: apps/tagma/desktop/scripts/build-host.ts
  - kind: file
    ref: apps/tagma/desktop/src/channel.ts
---
The cut hands `build-host` the distribution's channel (`TAGMA_HOST_CHANNEL`) and its brand's art directory (`TAGMA_HOST_ASSETS`), and `build-host` writes the channel into the main-process bundle as `BUILT_CHANNEL`. A bundle condition could only choose between channels this repository ships, and a distribution in another root has its own name, bundle id, data directory and port. A build with neither variable — the dev stand, `bun run build` — is the developer channel with this package's own art, and so is desktop code run from source in tests.
---
id: 01a175f3-4a6e-7ac6-86e0-03e831a58388
title: The update archive is picked by machine platform, not by process architecture
ord: 12
tags: ["explanation"]
sources:
  - kind: file
    ref: apps/tagma/server/src/installation/contract/service/platform.ts
  - kind: file
    ref: apps/tagma/server/src/installation/contract/wire/feed.ts
  - kind: file
    ref: apps/tagma/server/src/cut/stage.ts
  - kind: file
    ref: apps/tagma/server/src/installation/setup/macos.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/feed.ts
  - kind: file
    ref: apps/tagma/server/src/release-channel/install.ts
---
The installation platform and the process architecture may differ under Rosetta. The update source reads the `MachinePlatform` port; the macOS adapter detects the processor through `hw.optional.arm64`, and composition wires it in. The downloaded release's integrity check never requires matching the previous server's architecture. The release is installed by its own bun, and `install-from` matches the manifest against that process: x64 on Apple silicon is allowed under Rosetta, and its launcher accepts that machine, while the next archive is picked arm64. Availability is decided by the `platforms` of the feed's newest entry this release can read: no machine key means `platform-unavailable`, and no older release is offered instead.

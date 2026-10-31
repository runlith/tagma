---
id: 01a19278-53e6-7954-a6a3-678929658381
title: GPU counters outlive an AGX client only within its witnessed process
ord: 11
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/src/posix/macos/gpu.ts
  - kind: file
    ref: packages/execution-host/src/posix/macos/Sampler.ts
---
An AGX registry client's GPU total disappears with that client and may fall when a command queue disappears. The adapter accumulates nonnegative growth by registry-entry id within one kernel pid/birth witness, so a vanished client cannot subtract previously observed work and pid reuse starts another baseline. Unobserved work before a client disappears is unrecoverable. Only a visible client with a readable empty AppUsage proves measured zero; no client, an unread counter or an unsupported registry carries an unavailable reason.
---
id: 01a128bb-1327-70e5-8340-d144f9156057
title: The holder's available startup image is pinned by content, and a pinning refusal does not block launch
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/image.rs
  - kind: symbol
    ref: packages/execution-host/native/holder/src/posix/mod.rs
    symbol: open
---
So that a bundle swap or deletion of the source binary does not change the live holder's trampoline, macOS pins a separate image by content digest after matching LC_UUID with the running image. The copy syncs before atomic publication; reuse requires a digest match. The lease enters the holder's standing and is not recomputed on each launch. Cleanup under the writer claim is best-effort. If the image cannot be pinned, the holder diagnoses the cause and launches the trampoline via current_exe: terminal availability kept, but independence from later replacement of that path is not guaranteed in that mode.

---
id: 01a128bb-1327-70e5-8340-d144f9156057
title: The holder's available startup image is pinned by content, and a pinning refusal does not block launch
ord: 2
tags: ["explanation"]
sources:
  - kind: file
    ref: packages/execution-host/native/holder/src/macos/image.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/backend.rs
  - kind: file
    ref: packages/execution-host/native/holder/src/posix/image.rs
  - kind: symbol
    ref: packages/execution-host/native/holder/src/posix/mod.rs
    symbol: open
---
A bundle swap or removal of the original pathname must not change a live holder's trampoline. Shared POSIX custody pins the selected backend's running image by content, synchronizes it before publication and retains a lease across launches. macOS validates LC_UUID against its loaded image; Linux reads /proc/self/exe. Reuse requires the content digest to match. If pinning refuses, a diagnosed fallback keeps terminals available: Linux's locator still identifies the running image, while macOS current_exe cannot guarantee independence from later pathname replacement. Cleanup of unused images under the writer claim remains best-effort.
